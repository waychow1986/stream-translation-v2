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
