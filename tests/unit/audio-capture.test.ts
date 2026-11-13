import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type AudioModule = {
  resampleTo16Khz(samples: Float32Array, sampleRate: number): Float32Array;
  encodePcm16Le(samples: Float32Array): Uint8Array;
  framePcm(bytes: Uint8Array, stopping?: boolean): Uint8Array[];
  createPcmFrameAccumulator(
    onFrame: (frame: Uint8Array) => void,
  ): {
    push(bytes: Uint8Array): void;
    flush(): void;
  };
};

const moduleUrl = new URL("../../src/client/audio/capture.js", import.meta.url);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("browser audio capture", () => {
  async function load(): Promise<AudioModule> {
    return (await import(moduleUrl.href)) as AudioModule;
  }

  it("keeps 16 kHz samples and downsamples 48 kHz input", async () => {
    const { resampleTo16Khz } = await load();
    const original = Float32Array.from({ length: 1_600 }, (_, i) => i / 1_600);
    expect(resampleTo16Khz(original, 16_000)).toEqual(original);

    const highRate = Float32Array.from({ length: 4_800 }, (_, i) =>
      Math.sin((i / 48_000) * Math.PI * 440),
    );
    expect(resampleTo16Khz(highRate, 48_000)).toHaveLength(1_600);
  });

  it("encodes clamped PCM16 little endian", async () => {
    const { encodePcm16Le } = await load();
    expect([...encodePcm16Le(Float32Array.of(-2, 0, 0.5, 2))]).toEqual([
      0, 128, 0, 0, 0, 64, 255, 127,
    ]);
  });

  it("emits 100 ms frames and only permits a short tail while stopping", async () => {
    const { framePcm } = await load();
    const bytes = new Uint8Array(6_500);
    expect(framePcm(bytes)).toHaveLength(2);
    expect(framePcm(bytes).every((frame) => frame.byteLength === 3_200)).toBe(
      true,
    );
    expect(framePcm(bytes, true).map((frame) => frame.byteLength)).toEqual([
      3_200, 3_200, 100,
    ]);
  });

  it("accumulates small worklet callbacks without loss and flushes one tail", async () => {
    const { createPcmFrameAccumulator } = await load();
    const frames: Uint8Array[] = [];
    const accumulator = createPcmFrameAccumulator((frame) => frames.push(frame));
    const input = Uint8Array.from({ length: 6_450 }, (_, index) => index % 251);

    for (let offset = 0; offset < input.length; offset += 86) {
      accumulator.push(input.slice(offset, offset + 86));
    }
    expect(frames.map((frame) => frame.byteLength)).toEqual([3_200, 3_200]);

    accumulator.flush();
    accumulator.flush();
    expect(frames.map((frame) => frame.byteLength)).toEqual([3_200, 3_200, 50]);
    expect([...Uint8Array.from(frames.flatMap((frame) => [...frame]))]).toEqual([
      ...input,
    ]);
  });
});
