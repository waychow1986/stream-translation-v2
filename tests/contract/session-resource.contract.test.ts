import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type ResourceModule = {
  createResourceTrackedSession(options: {
    translate(sequence: number): Promise<void>;
    close(code: number): void;
  }): {
    enqueue(text: string): Promise<void>;
    drain(): Promise<void>;
    abort(): Promise<void>;
    snapshot(): {
      activeRequests: number;
      queuedSegments: number;
      deliveredSequences: number[];
      reachableReferences: number;
    };
  };
};

const moduleUrl = new URL(
  "../../src/server/session/translation-session.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("session resource bounds", () => {
  async function load(): Promise<ResourceModule> {
    return (await import(moduleUrl.href)) as ResourceModule;
  }

  it("processes two queue windows with one active request and no loss", async () => {
    const { createResourceTrackedSession } = await load();
    let maxActive = 0;
    let maxQueued = 0;
    let session!: ReturnType<
      ResourceModule["createResourceTrackedSession"]
    >;
    session = createResourceTrackedSession({
      translate: async () => {
        const snapshot = session.snapshot();
        maxActive = Math.max(maxActive, snapshot.activeRequests);
        maxQueued = Math.max(maxQueued, snapshot.queuedSegments);
      },
      close: vi.fn(),
    });
    for (let sequence = 1; sequence <= 34; sequence += 1) {
      await session.enqueue(`fixture-${sequence}`);
    }
    await session.drain();
    expect(maxActive).toBe(1);
    expect(maxQueued).toBeLessThanOrEqual(16);
    expect(session.snapshot().deliveredSequences).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    );
    expect(session.snapshot().reachableReferences).toBe(0);
  });

  it("closes when the seventeenth queued segment exceeds the bound", async () => {
    const { createResourceTrackedSession } = await load();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn();
    const session = createResourceTrackedSession({
      translate: async () => held,
      close,
    });
    void session.enqueue("active");
    await Promise.resolve();
    for (let index = 0; index < 16; index += 1) {
      void session.enqueue(`queued-${index}`);
    }
    expect(session.snapshot()).toMatchObject({
      activeRequests: 1,
      queuedSegments: 16,
    });
    await expect(session.enqueue("overflow")).rejects.toMatchObject({
      category: "resource_exhausted",
    });
    expect(close).toHaveBeenCalledWith(1011);
    release();
    await session.abort();
    expect(session.snapshot().reachableReferences).toBe(0);
  });
});
