import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type RecoveryModule = {
  createRecoveringSpeechConnection(options: {
    createRecognizer(): Promise<{
      start(): Promise<void>;
      write(frame: Uint8Array): void;
      dispose(): Promise<void>;
    }>;
    close(code: number): void;
  }): {
    start(): Promise<void>;
    write(frame: Uint8Array): void;
    canceled(event: { transient: boolean }): Promise<void>;
    stop(): Promise<void>;
  };
};

type SpeechAdapterModule = {
    createProductionSpeechRecognizer(options: {
      sdk: Record<string, unknown>;
      speechConfig: {
        setProperty(property: unknown, value: string): void;
      };
      locales: string[];
      callbacks: {
        recognized(event: { text?: string; locale?: string }): void;
        unrecognized(): void;
        canceled(event: { transient: boolean }): void;
      };
    }): Promise<{
      start(): Promise<void>;
      write(frame: Uint8Array): void;
      dispose(): Promise<void>;
    }>;
};

const moduleUrl = new URL(
  "../../src/server/session/orchestrator.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("Speech connection recovery", () => {
  async function load(): Promise<RecoveryModule> {
    return (await import(moduleUrl.href)) as RecoveryModule;
  }

  it("configures the production recognizer for continuous language identification", async () => {
    const adapter = (await import(
      "../../src/server/adapters/speech-recognizer.js"
    )) as SpeechAdapterModule;
    const setProperty = vi.fn();
    const recognizer = {
      startContinuousRecognitionAsync: vi.fn((resolve: () => void) => resolve()),
      stopContinuousRecognitionAsync: vi.fn((resolve: () => void) => resolve()),
      close: vi.fn(),
    };
    const pushStream = { write: vi.fn(), close: vi.fn() };
    const sdk = {
      PropertyId: { SpeechServiceConnection_LanguageIdMode: "lid-mode" },
      AutoDetectSourceLanguageConfig: {
        fromLanguages: vi.fn(() => "auto-detect"),
      },
      AudioStreamFormat: {
        getWaveFormatPCM: vi.fn(() => "format"),
      },
      AudioInputStream: {
        createPushStream: vi.fn(() => pushStream),
      },
      AudioConfig: {
        fromStreamInput: vi.fn(() => "audio-config"),
      },
      SpeechRecognizer: {
        FromConfig: vi.fn(() => recognizer),
      },
      AutoDetectSourceLanguageResult: {
        fromResult: vi.fn(() => ({ language: "en-US" })),
      },
    };
    const connection = await adapter.createProductionSpeechRecognizer({
      sdk,
      speechConfig: { setProperty },
      locales: ["en-US", "fr-FR"],
      callbacks: {
        recognized: vi.fn(),
        unrecognized: vi.fn(),
        canceled: vi.fn(),
      },
    });
    await connection.start();
    expect(setProperty).toHaveBeenCalledWith("lid-mode", "Continuous");
    expect(sdk.SpeechRecognizer.FromConfig).toHaveBeenCalledWith(
      expect.anything(),
      "auto-detect",
      "audio-config",
    );
    await connection.dispose();
  });

  it("rebuilds once without replaying prior audio", async () => {
    const { createRecoveringSpeechConnection } = await load();
    const recognizers = Array.from({ length: 2 }, () => ({
      start: vi.fn(async () => undefined),
      write: vi.fn(),
      dispose: vi.fn(async () => undefined),
    }));
    const createRecognizer = vi
      .fn()
      .mockResolvedValueOnce(recognizers[0])
      .mockResolvedValueOnce(recognizers[1]);
    const connection = createRecoveringSpeechConnection({
      createRecognizer,
      close: vi.fn(),
    });
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    await connection.start();
    connection.write(first);
    await connection.canceled({ transient: true });
    connection.write(second);
    expect(recognizers[0]?.write).toHaveBeenCalledWith(first);
    expect(recognizers[1]?.write).toHaveBeenCalledTimes(1);
    expect(recognizers[1]?.write).toHaveBeenCalledWith(second);
    expect(recognizers[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("closes on a second cancellation or non-transient cancellation", async () => {
    const { createRecoveringSpeechConnection } = await load();
    const close = vi.fn();
    const createRecognizer = vi.fn(async () => ({
      start: async () => undefined,
      write: vi.fn(),
      dispose: async () => undefined,
    }));
    const connection = createRecoveringSpeechConnection({
      createRecognizer,
      close,
    });
    await connection.start();
    await connection.canceled({ transient: true });
    await connection.canceled({ transient: true });
    expect(close).toHaveBeenCalledWith(1011);

    const second = createRecoveringSpeechConnection({
      createRecognizer,
      close,
    });
    await second.start();
    await second.canceled({ transient: false });
    expect(close).toHaveBeenCalledWith(1011);
  });

  it("gives stop priority over an in-flight rebuild and disposes once", async () => {
    const { createRecoveringSpeechConnection } = await load();
    let resolveCreate!: (value: {
      start(): Promise<void>;
      write(frame: Uint8Array): void;
      dispose(): Promise<void>;
    }) => void;
    const replacement = {
      start: vi.fn(async () => undefined),
      write: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    const first = {
      start: vi.fn(async () => undefined),
      write: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    const createRecognizer = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );
    const connection = createRecoveringSpeechConnection({
      createRecognizer,
      close: vi.fn(),
    });
    await connection.start();
    const rebuilding = connection.canceled({ transient: true });
    const stopping = connection.stop();
    resolveCreate(replacement);
    await Promise.all([rebuilding, stopping]);
    expect(replacement.start).not.toHaveBeenCalled();
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });
});
