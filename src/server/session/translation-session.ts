const QUEUE_LIMIT = 16;

export function createResourceTrackedSession(options: {
  translate(sequence: number): Promise<void>;
  close(code: number): void;
}) {
  type Entry = { sequence: number; text: string };
  const queue: Entry[] = [];
  const deliveredSequences: number[] = [];
  let nextSequence = 1;
  let active: Entry | undefined;
  let worker: Promise<void> | undefined;
  let aborted = false;

  const run = async () => {
    while (!aborted && queue.length) {
      active = queue.shift();
      if (!active) break;
      try {
        await options.translate(active.sequence);
        if (!aborted) deliveredSequences.push(active.sequence);
      } finally {
        active = undefined;
      }
    }
  };
  const ensureWorker = () => {
    if (!worker) {
      worker = run().finally(() => {
        worker = undefined;
        if (!aborted && queue.length) ensureWorker();
      });
    }
  };
  return {
    async enqueue(text: string) {
      if (aborted) throw { category: "internal" };
      if (queue.length >= QUEUE_LIMIT) {
        options.close(1011);
        throw { category: "resource_exhausted" };
      }
      queue.push({ sequence: nextSequence, text });
      nextSequence += 1;
      ensureWorker();
      await Promise.resolve();
    },
    async drain() {
      while (worker) await worker;
    },
    async abort() {
      aborted = true;
      queue.length = 0;
      if (worker) await worker;
      active = undefined;
    },
    snapshot() {
      return {
        activeRequests: active ? 1 : 0,
        queuedSegments: queue.length,
        deliveredSequences: [...deliveredSequences],
        reachableReferences: (active ? 1 : 0) + queue.length,
      };
    },
  };
}
