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
    const encoded =
      value === 1 ? 0x7fff : Math.max(-0x8000, Math.round(value * 0x8000));
    view.setInt16(index * 2, encoded, true);
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

export function createPcmFrameAccumulator(
  onFrame: (frame: Uint8Array) => void,
): {
  push(bytes: Uint8Array): void;
  flush(): void;
} {
  let pending = new Uint8Array();
  let flushed = false;
  return {
    push(bytes) {
      if (flushed || bytes.byteLength === 0) return;
      const combined = new Uint8Array(pending.byteLength + bytes.byteLength);
      combined.set(pending);
      combined.set(bytes, pending.byteLength);
      const frames = framePcm(combined);
      for (const frame of frames) onFrame(frame);
      pending = combined.slice(frames.length * AUDIO_FRAME_BYTES);
    },
    flush() {
      if (flushed) return;
      flushed = true;
      if (pending.byteLength > 0) onFrame(pending);
      pending = new Uint8Array();
    },
  };
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
  const accumulator = createPcmFrameAccumulator(onFrame);
  worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    accumulator.push(
      encodePcm16Le(resampleTo16Khz(data, context.sampleRate)),
    );
  };
  source.connect(worklet);
  worklet.connect(context.destination);
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((track) => track.stop());
      worklet.port.onmessage = null;
      accumulator.flush();
      worklet.disconnect();
      source.disconnect();
      await context.close();
    },
  };
}
