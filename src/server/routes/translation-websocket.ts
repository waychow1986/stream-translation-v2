import type { FastifyInstance } from "fastify";
import "@fastify/websocket";

import {
  TRANSLATION_SUBPROTOCOL,
  validateAudioFrame,
  validateClientControlEvent,
} from "../../shared/protocol.js";

export function validateUpgrade(input: {
  origin?: string;
  protocol?: string;
  expectedOrigin: string;
  draining: boolean;
}): { accepted: boolean; closeCode?: number } {
  if (input.draining || input.origin !== input.expectedOrigin) {
    return { accepted: false, closeCode: 1008 };
  }
  if (input.protocol !== TRANSLATION_SUBPROTOCOL) {
    return { accepted: false, closeCode: 1002 };
  }
  return { accepted: true };
}

export function validateInbound(input: {
  state: "connecting" | "listening" | "draining" | "closed";
  data: unknown;
  binary: boolean;
}): { accepted: boolean; closeCode?: number } {
  if (input.binary) {
    return input.state === "listening" && validateAudioFrame(input.data)
      ? { accepted: true }
      : { accepted: false, closeCode: 1002 };
  }
  return validateClientControlEvent(input.data)
    ? { accepted: true }
    : { accepted: false, closeCode: 1002 };
}

const released = new WeakSet<object>();
export function releaseConnection(resources: Array<{ dispose(): void }>) {
  for (const resource of resources) {
    if (released.has(resource)) continue;
    released.add(resource);
    resource.dispose();
  }
}

export async function startGatewaySession(options: {
  start(): Promise<{ sessionId: string }>;
  sendReady(sessionId: string): void;
  close(code: number): void;
  dispose(): void;
}): Promise<boolean> {
  try {
    const { sessionId } = await options.start();
    options.sendReady(sessionId);
    return true;
  } catch {
    options.close(1011);
    options.dispose();
    return false;
  }
}

export function registerTranslationWebsocket(
  app: FastifyInstance,
  options: {
    expectedOrigin: string;
    isDraining(): boolean;
    createSession(
      send: (event: unknown) => void,
      close: (code: number) => void,
    ): {
      start(): Promise<{ sessionId: string }>;
      write(frame: Uint8Array): void;
      stop(): Promise<void>;
      dispose(): void;
    };
  },
) {
  app.get(
    "/ws/translation",
    { websocket: true },
    (socket, request) => {
      const upgrade = validateUpgrade({
        origin: request.headers.origin,
        protocol: request.headers["sec-websocket-protocol"],
        expectedOrigin: options.expectedOrigin,
        draining: options.isDraining(),
      });
      if (!upgrade.accepted) {
        socket.close(upgrade.closeCode);
        return;
      }
      let state: "connecting" | "listening" | "draining" | "closed" =
        "connecting";
      let closed = false;
      let disposed = false;
      const close = (code: number) => {
        if (closed) return;
        closed = true;
        socket.close(code);
      };
      const session = options.createSession(
        (event) => socket.send(JSON.stringify(event)),
        close,
      );
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        session.dispose();
      };
      socket.on("message", async (raw: Buffer, binary: boolean) => {
        const data = binary
          ? new Uint8Array(raw)
          : (() => {
              try {
                return JSON.parse(raw.toString()) as unknown;
              } catch {
                return undefined;
              }
            })();
        const validation = validateInbound({ state, data, binary });
        if (!validation.accepted) {
          close(validation.closeCode ?? 1002);
          dispose();
          state = "closed";
          return;
        }
        if (binary) {
          session.write(data as Uint8Array);
        } else if (
          (data as { type?: string }).type === "session.start" &&
          state === "connecting"
        ) {
          const started = await startGatewaySession({
            start: session.start,
            close,
            dispose,
            sendReady(sessionId) {
              socket.send(
                JSON.stringify({
                  type: "session.ready",
                  protocolVersion: 1,
                  sessionId,
                }),
              );
            },
          });
          state = started ? "listening" : "closed";
        } else if ((data as { type?: string }).type === "session.stop") {
          state = "draining";
          await session.stop();
          socket.close(1000);
          state = "closed";
        }
      });
      socket.on("close", () => {
        closed = true;
        state = "closed";
        dispose();
      });
    },
  );
}
