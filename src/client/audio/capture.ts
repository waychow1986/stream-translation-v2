import { AUDIO_FRAME_BYTES } from "../../shared/protocol.js";

export function resampleTo16Khz(
  samples: Float32Array,
  sampleRate: number,
): Float32Array {
  if (sampleRate <= 0) throw new Error("Invalid sample rate");
  if (sampleRate === 16_000) return samples;
  const output = new Float32Array(
    Math.floor((samples.length * 16_000) / sampleRate),
  );
  const ratio = sampleRate / 16_000;
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let source = start; source < end; source += 1) {
      total += samples[source] ?? 0;
    }
    output[index] = total / (end - start);
  }
  return output;
}

export function encodePcm16Le(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      index * 2,
      value < 0 ? value * 0x8000 : value * 0x7fff,
      true,
    );
  });
  return output;
}

export function framePcm(
  bytes: Uint8Array,
  stopping = false,
): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (
    let offset = 0;
    offset + AUDIO_FRAME_BYTES <= bytes.length;
    offset += AUDIO_FRAME_BYTES
  ) {
    frames.push(bytes.slice(offset, offset + AUDIO_FRAME_BYTES));
  }
  const remainder = bytes.length % AUDIO_FRAME_BYTES;
  if (stopping && remainder > 0) {
    frames.push(bytes.slice(bytes.length - remainder));
  }
  return frames;
}

export async function createAudioCapture(
  onFrame: (frame: Uint8Array) => void,
): Promise<{ stop(): Promise<void> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  await context.audioWorklet.addModule(
    new URL("./pcm-worklet.js", import.meta.url),
  );
  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, "pcm-capture");
  worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    for (const frame of framePcm(
      encodePcm16Le(resampleTo16Khz(data, context.sampleRate)),
    )) {
      onFrame(frame);
    }
  };
  source.connect(worklet);
  worklet.connect(context.destination);
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((track) => track.stop());
      worklet.disconnect();
      source.disconnect();
      await context.close();
    },
  };
}
