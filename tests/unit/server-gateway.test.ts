import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type GatewayModule = {
  validateUpgrade(input: {
    origin?: string;
    protocol?: string;
    expectedOrigin: string;
    draining: boolean;
  }): { accepted: boolean; closeCode?: number };
  validateInbound(input: {
    state: "connecting" | "listening" | "draining" | "closed";
    data: unknown;
    binary: boolean;
  }): { accepted: boolean; closeCode?: number };
  releaseConnection(resources: Array<{ dispose(): void }>): void;
  startGatewaySession(options: {
    start(): Promise<{ sessionId: string }>;
    sendReady(sessionId: string): void;
    close(code: number): void;
    dispose(): void;
  }): Promise<boolean>;
};

const moduleUrl = new URL(
  "../../src/server/routes/translation-websocket.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("Fastify translation gateway boundaries", () => {
  async function load(): Promise<GatewayModule> {
    return (await import(moduleUrl.href)) as GatewayModule;
  }

  it("accepts only exact origin and translation.v1 while not draining", async () => {
    const { validateUpgrade } = await load();
    const valid = {
      origin: "https://translation.example",
      protocol: "translation.v1",
      expectedOrigin: "https://translation.example",
      draining: false,
    };
    expect(validateUpgrade(valid)).toEqual({ accepted: true });
    expect(validateUpgrade({ ...valid, origin: "https://evil.example" })).toEqual(
      { accepted: false, closeCode: 1008 },
    );
    expect(validateUpgrade({ ...valid, protocol: "other" })).toEqual({
      accepted: false,
      closeCode: 1002,
    });
    expect(validateUpgrade({ ...valid, draining: true }).accepted).toBe(false);
  });

  it("allows only valid controls and bounded binary frames in state", async () => {
    const { validateInbound } = await load();
    expect(
      validateInbound({
        state: "listening",
        data: new Uint8Array(3_200),
        binary: true,
      }).accepted,
    ).toBe(true);
    expect(
      validateInbound({
        state: "connecting",
        data: new Uint8Array(3_200),
        binary: true,
      }),
    ).toEqual({ accepted: false, closeCode: 1002 });
    expect(
      validateInbound({
        state: "listening",
        data: new Uint8Array(3_201),
        binary: true,
      }),
    ).toEqual({ accepted: false, closeCode: 1002 });
    expect(
      validateInbound({
        state: "listening",
        data: { type: "unknown", providerToken: "secret" },
        binary: false,
      }).accepted,
    ).toBe(false);
  });

  it("releases every connection resource once after an exception", async () => {
    const { releaseConnection } = await load();
    const resources = [{ dispose: vi.fn() }, { dispose: vi.fn() }];
    releaseConnection(resources);
    releaseConnection(resources);
    expect(resources.every(({ dispose }) => dispose.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("closes and releases without sending ready when session startup fails", async () => {
    const { startGatewaySession } = await load();
    const sendReady = vi.fn();
    const close = vi.fn();
    const dispose = vi.fn();

    await expect(
      startGatewaySession({
        start: vi.fn().mockRejectedValue(new Error("Speech unavailable")),
        sendReady,
        close,
        dispose,
      }),
    ).resolves.toBe(false);

    expect(sendReady).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(1011);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
