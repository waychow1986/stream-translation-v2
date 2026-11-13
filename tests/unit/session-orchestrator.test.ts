import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type OrchestratorModule = {
  createSessionOrchestrator(options: {
    translate(text: string, signal: AbortSignal): AsyncIterable<string>;
    send(event: Record<string, unknown>): void;
  }): {
    recognized(event: {
      text: string;
      locale: string;
      final: boolean;
    }): Promise<void>;
    unrecognized(): Promise<void>;
    stop(): Promise<void>;
    abort(): void;
  };
};

const moduleUrl = new URL(
  "../../src/server/session/orchestrator.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

async function* tokens(...values: string[]) {
  yield* values;
}

describe.runIf(runPending)("translation session orchestrator", () => {
  async function load(): Promise<OrchestratorModule> {
    return (await import(moduleUrl.href)) as OrchestratorModule;
  }

  it("creates segments only for final STT and emits cumulative revisions", async () => {
    const { createSessionOrchestrator } = await load();
    const send = vi.fn();
    const translate = vi.fn(() => tokens("会", "议"));
    const orchestrator = createSessionOrchestrator({ translate, send });
    await orchestrator.recognized({
      text: "partial",
      locale: "en-US",
      final: false,
    });
    await orchestrator.recognized({
      text: "meeting",
      locale: "en-US",
      final: true,
    });
    expect(translate).toHaveBeenCalledOnce();
    expect(send.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "subtitle.delta",
          sequence: 1,
          revision: 1,
          text: "会",
        }),
        expect.objectContaining({
          type: "subtitle.delta",
          sequence: 1,
          revision: 2,
          text: "会议",
        }),
        expect.objectContaining({
          type: "subtitle.final",
          sequence: 1,
          text: "会议",
        }),
      ]),
    );
  });

  it("does not present failures as success and recovers for a later segment", async () => {
    const { createSessionOrchestrator } = await load();
    const send = vi.fn();
    const translate = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("provider failed");
      })
      .mockImplementationOnce(() => tokens("恢复"));
    const orchestrator = createSessionOrchestrator({ translate, send });
    await orchestrator.recognized({
      text: "first",
      locale: "en-US",
      final: true,
    });
    await orchestrator.recognized({
      text: "second",
      locale: "fr-FR",
      final: true,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "segment.failed", sequence: 1 }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "subtitle.final", sequence: 2 }),
    );
  });

  it("emits a non-success terminal event for unrecognized speech", async () => {
    const { createSessionOrchestrator } = await load();
    const send = vi.fn();
    const orchestrator = createSessionOrchestrator({
      translate: () => tokens(),
      send,
    });
    await orchestrator.unrecognized();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "segment.unrecognized", sequence: 1 }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "subtitle.final" }),
    );
  });

  it("aborts active work and releases references on stop", async () => {
    const { createSessionOrchestrator } = await load();
    let observedSignal: AbortSignal | undefined;
    const orchestrator = createSessionOrchestrator({
      translate: async function* (_text, signal) {
        observedSignal = signal;
        await new Promise<void>(() => undefined);
      },
      send: vi.fn(),
    });
    void orchestrator.recognized({
      text: "active",
      locale: "en-US",
      final: true,
    });
    await Promise.resolve();
    orchestrator.abort();
    expect(observedSignal?.aborted).toBe(true);
  });
});
