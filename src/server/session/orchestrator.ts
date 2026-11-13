import { randomUUID } from "node:crypto";

export function createSessionOrchestrator(options: {
  translate(text: string, signal: AbortSignal): AsyncIterable<string>;
  send(event: Record<string, unknown>): void;
  sessionId?: string;
}) {
  const sessionId = options.sessionId ?? randomUUID();
  const controller = new AbortController();
  let sequence = 0;
  let stopped = false;

  const base = (current: number) => ({
    protocolVersion: 1,
    sessionId,
    segmentId: `${sessionId}:${current}`,
    sequence: current,
  });
  return {
    async recognized(event: {
      text: string;
      locale: string;
      final: boolean;
    }) {
      if (!event.final || stopped) return;
      sequence += 1;
      const current = sequence;
      options.send({
        ...base(current),
        type: "segment.detected",
        sourceLocale: event.locale,
      });
      let text = "";
      let revision = 0;
      try {
        for await (const token of options.translate(
          event.text,
          controller.signal,
        )) {
          if (controller.signal.aborted) return;
          text += token;
          revision += 1;
          options.send({
            ...base(current),
            type: "subtitle.delta",
            revision,
            text,
            isFinal: false,
          });
        }
        if (text) {
          options.send({
            ...base(current),
            type: "subtitle.final",
            revision: revision + 1,
            text,
            isFinal: true,
          });
        } else {
          throw new Error("Empty translation");
        }
      } catch {
        if (!controller.signal.aborted) {
          options.send({
            ...base(current),
            type: "segment.failed",
            category: "translation_connection",
          });
        }
      }
    },
    async unrecognized() {
      if (stopped) return;
      sequence += 1;
      options.send({
        ...base(sequence),
        type: "segment.unrecognized",
      });
    },
    async stop() {
      stopped = true;
    },
    abort() {
      stopped = true;
      controller.abort();
    },
  };
}

export function createRecoveringSpeechConnection(options: {
  createRecognizer(): Promise<{
    start(): Promise<void>;
    write(frame: Uint8Array): void;
    dispose(): Promise<void>;
  }>;
  close(code: number): void;
}) {
  type Recognizer = Awaited<ReturnType<typeof options.createRecognizer>>;
  let recognizer: Recognizer | undefined;
  let recovering = false;
  let recovered = false;
  let stopped = false;
  const disposed = new WeakSet<object>();
  const dispose = async (value: Recognizer | undefined) => {
    if (!value || disposed.has(value)) return;
    disposed.add(value);
    await value.dispose();
  };
  return {
    async start() {
      if (stopped) return;
      const created = await options.createRecognizer();
      if (stopped) {
        await dispose(created);
        return;
      }
      await created.start();
      recognizer = created;
    },
    write(frame: Uint8Array) {
      if (!stopped && !recovering) recognizer?.write(frame);
    },
    async canceled(event: { transient: boolean }) {
      if (
        stopped ||
        recovering ||
        recovered ||
        !event.transient
      ) {
        if (!stopped) options.close(1011);
        return;
      }
      recovering = true;
      recovered = true;
      const previous = recognizer;
      recognizer = undefined;
      const disposing = dispose(previous);
      const replacementPromise = options.createRecognizer();
      try {
        await disposing;
        const replacement = await replacementPromise;
        if (stopped) {
          await dispose(replacement);
          return;
        }
        await replacement.start();
        if (stopped) {
          await dispose(replacement);
          return;
        }
        recognizer = replacement;
      } catch {
        if (!stopped) options.close(1011);
      } finally {
        recovering = false;
      }
    },
    async stop() {
      stopped = true;
      const current = recognizer;
      recognizer = undefined;
      await dispose(current);
    },
  };
}
