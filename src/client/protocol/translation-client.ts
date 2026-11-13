import {
  AUDIO_FORMAT,
  PROTOCOL_VERSION,
  validateServerEvent,
  type ServerEvent,
} from "../../shared/protocol.js";

export function createTranslationClient(options: {
  socket: {
    send(data: string | ArrayBufferView): void;
    close(code?: number): void;
  };
  stopMedia(): void;
  onEvent?(event: ServerEvent): void;
}) {
  let sessionId: string | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    options.stopMedia();
  };
  return {
    start() {
      options.socket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: PROTOCOL_VERSION,
          audio: AUDIO_FORMAT,
        }),
      );
    },
    receive(value: unknown) {
      const event =
        typeof value === "string" ? (JSON.parse(value) as unknown) : value;
      if (!validateServerEvent(event)) {
        release();
        options.socket.close(1002);
        return;
      }
      if (event.type === "session.ready") sessionId = event.sessionId;
      options.onEvent?.(event);
    },
    sendAudio(frame: Uint8Array) {
      if (sessionId) options.socket.send(frame);
    },
    stop() {
      release();
      if (sessionId) {
        options.socket.send(
          JSON.stringify({
            type: "session.stop",
            protocolVersion: PROTOCOL_VERSION,
            sessionId,
          }),
        );
      }
    },
    unload() {
      release();
      options.socket.close(1000);
    },
  };
}
