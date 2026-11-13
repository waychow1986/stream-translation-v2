import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type SpeechModule = {
  createSpeechRecognizer(options: {
    locales: string[];
    sdk: Record<string, unknown>;
  }): {
    start(callbacks: Record<string, (event: unknown) => void>): Promise<void>;
    write(frame: Uint8Array): void;
    close(): Promise<void>;
  };
};

const moduleUrl = new URL(
  "../../src/server/adapters/speech-recognizer.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("Speech adapter contract", () => {
  async function load(): Promise<SpeechModule> {
    return (await import(moduleUrl.href)) as SpeechModule;
  }

  it("rejects empty, Chinese and duplicate language candidates", async () => {
    const { createSpeechRecognizer } = await load();
    expect(() => createSpeechRecognizer({ locales: [], sdk: {} })).toThrow();
    expect(() =>
      createSpeechRecognizer({ locales: ["zh-CN"], sdk: {} }),
    ).toThrow();
    expect(() =>
      createSpeechRecognizer({ locales: ["en-US", "en-US"], sdk: {} }),
    ).toThrow();
  });

  it("creates a push stream with continuous language identification", async () => {
    const { createSpeechRecognizer } = await load();
    const startContinuousRecognitionAsync = vi.fn(
      (resolve: () => void) => resolve(),
    );
    const sdk = {
      createPushStream: vi.fn(() => ({ write: vi.fn(), close: vi.fn() })),
      createRecognizer: vi.fn(() => ({
        startContinuousRecognitionAsync,
        stopContinuousRecognitionAsync: (resolve: () => void) => resolve(),
        close: vi.fn(),
      })),
    };
    const recognizer = createSpeechRecognizer({
      locales: ["en-US", "fr-FR"],
      sdk,
    });
    await recognizer.start({});
    expect(sdk.createPushStream).toHaveBeenCalledOnce();
    expect(sdk.createRecognizer).toHaveBeenCalledWith(
      expect.objectContaining({ languageIdentificationMode: "Continuous" }),
    );
    expect(startContinuousRecognitionAsync).toHaveBeenCalledOnce();
  });

  it("maps stable, unrecognized and canceled events and disposes once", async () => {
    const { createSpeechRecognizer } = await load();
    const closeStream = vi.fn();
    const closeRecognizer = vi.fn();
    const handlers: Record<string, (event: unknown) => void> = {};
    const sdk = {
      createPushStream: () => ({ write: vi.fn(), close: closeStream }),
      createRecognizer: () => ({
        on: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
        startContinuousRecognitionAsync: (resolve: () => void) => resolve(),
        stopContinuousRecognitionAsync: (resolve: () => void) => resolve(),
        close: closeRecognizer,
      }),
    };
    const callbacks = {
      recognized: vi.fn(),
      unrecognized: vi.fn(),
      canceled: vi.fn(),
    };
    const recognizer = createSpeechRecognizer({ locales: ["en-US"], sdk });
    await recognizer.start(callbacks);
    handlers["recognized"]?.({ text: "hello", locale: "en-US", final: true });
    handlers["unrecognized"]?.({});
    handlers["canceled"]?.({ category: "authentication" });
    await recognizer.close();
    await recognizer.close();
    expect(callbacks.recognized).toHaveBeenCalledOnce();
    expect(callbacks.unrecognized).toHaveBeenCalledOnce();
    expect(callbacks.canceled).toHaveBeenCalledWith({
      category: "speech_authentication",
      transient: false,
    });
    expect(closeStream).toHaveBeenCalledOnce();
    expect(closeRecognizer).toHaveBeenCalledOnce();
  });
});
