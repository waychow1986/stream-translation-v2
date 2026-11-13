import { randomUUID } from "node:crypto";

export function createSessionOrchestrator(options: {
  translate(text: string, signal: AbortSignal): AsyncIterable<string>;
  send(event: Record<string, unknown>): void;
  close?(code: number): void;
  sessionId?: string;
}) {
  type Entry =
    | {
        type: "recognized";
        sequence: number;
        text: string;
        locale: string;
        resolve(): void;
      }
    | { type: "unrecognized"; sequence: number; resolve(): void };
  type EnqueueEntry =
    | { type: "recognized"; text: string; locale: string }
    | { type: "unrecognized" };
  const queue: Entry[] = [];
  const sessionId = options.sessionId ?? randomUUID();
  const controller = new AbortController();
  let sequence = 0;
  let stopped = false;
  let worker: Promise<void> | undefined;

  const base = (current: number) => ({
    protocolVersion: 1,
    sessionId,
    segmentId: `${sessionId}:${current}`,
    sequence: current,
  });
  const process = async (entry: Entry) => {
    if (entry.type === "unrecognized") {
      options.send({
        ...base(entry.sequence),
        type: "segment.unrecognized",
      });
      return;
    }
    options.send({
      ...base(entry.sequence),
      type: "segment.detected",
      sourceLocale: entry.locale,
    });
    let text = "";
    let revision = 0;
    try {
      for await (const token of options.translate(
        entry.text,
        controller.signal,
      )) {
        if (controller.signal.aborted) return;
        text += token;
        revision += 1;
        options.send({
          ...base(entry.sequence),
          type: "subtitle.delta",
          revision,
          text,
          isFinal: false,
        });
      }
      if (!text) throw new Error("Empty translation");
      options.send({
        ...base(entry.sequence),
        type: "subtitle.final",
        revision: revision + 1,
        text,
        isFinal: true,
      });
    } catch {
      if (!controller.signal.aborted) {
        options.send({
          ...base(entry.sequence),
          type: "segment.failed",
          category: "translation_connection",
        });
      }
    }
  };
  const run = async () => {
    while (!controller.signal.aborted && queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      await process(entry);
      entry.resolve();
    }
  };
  const ensureWorker = () => {
    if (worker) return;
    worker = run().finally(() => {
      worker = undefined;
      if (!controller.signal.aborted && queue.length) ensureWorker();
    });
  };
  const enqueue = (entry: EnqueueEntry): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (queue.length >= 16) {
      options.close?.(1011);
      return Promise.resolve();
    }
    sequence += 1;
    return new Promise<void>((resolve) => {
      queue.push({ ...entry, sequence, resolve } as Entry);
      ensureWorker();
    });
  };
  return {
    recognized(event: { text: string; locale: string; final: boolean }) {
      if (!event.final) return Promise.resolve();
      return enqueue({
        type: "recognized",
        text: event.text,
        locale: event.locale,
      });
    },
    unrecognized() {
      return enqueue({ type: "unrecognized" });
    },
    async stop() {
      stopped = true;
      while (worker) await worker;
    },
    abort() {
      stopped = true;
      controller.abort();
      for (const entry of queue.splice(0)) entry.resolve();
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
      let created: Recognizer | undefined;
      try {
        created = await options.createRecognizer();
        if (stopped) {
          await dispose(created);
          return;
        }
        await created.start();
        recognizer = created;
      } catch (error) {
        stopped = true;
        await dispose(created);
        options.close(1011);
        throw error;
      }
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
      let replacement: Recognizer | undefined;
      try {
        await dispose(previous);
        if (stopped) return;
        replacement = await options.createRecognizer();
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
        await dispose(replacement);
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
