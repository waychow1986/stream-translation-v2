import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type TranslationClientModule = {
  createTranslationClient(options: {
    socket: {
      send(data: string | ArrayBufferView): void;
      close(code?: number): void;
    };
    stopMedia(): void;
  }): {
    start(): void;
    receive(event: unknown): void;
    sendAudio(frame: Uint8Array): void;
    stop(): void;
    unload(): void;
  };
};

const moduleUrl = new URL(
  "../../src/client/protocol/translation-client.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("translation WebSocket client lifecycle", () => {
  async function setup() {
    const { createTranslationClient } =
      (await import(moduleUrl.href)) as TranslationClientModule;
    const socket = { send: vi.fn(), close: vi.fn() };
    const stopMedia = vi.fn();
    return {
      client: createTranslationClient({ socket, stopMedia }),
      socket,
      stopMedia,
    };
  }

  it("does not send audio before ready", async () => {
    const { client, socket } = await setup();
    client.start();
    client.sendAudio(new Uint8Array(3_200));
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] as string)).toMatchObject({
      type: "session.start",
      protocolVersion: 1,
    });
  });

  it("sends audio after ready and releases media on stop", async () => {
    const { client, socket, stopMedia } = await setup();
    client.start();
    client.receive({
      type: "session.ready",
      protocolVersion: 1,
      sessionId: "9a7f62d0-724a-4f15-9c2c-8e54df9c91c5",
    });
    client.sendAudio(new Uint8Array(3_200));
    client.stop();
    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(stopMedia).toHaveBeenCalledOnce();
  });

  it("releases media and closes only once on unload", async () => {
    const { client, socket, stopMedia } = await setup();
    client.unload();
    client.unload();
    expect(stopMedia).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
