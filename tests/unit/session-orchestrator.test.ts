import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type OrchestratorModule = {
  createSessionOrchestrator(options: {
    translate(text: string, signal: AbortSignal): AsyncIterable<string>;
    send(event: Record<string, unknown>): void;
    close?(code: number): void;
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

  it("serializes concurrent stable segments in strict sequence", async () => {
    const { createSessionOrchestrator } = await load();
    const send = vi.fn();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const orchestrator = createSessionOrchestrator({
      translate: async function* (text) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        yield text;
        active -= 1;
      },
      send,
    });

    const first = orchestrator.recognized({
      text: "first",
      locale: "en-US",
      final: true,
    });
    const second = orchestrator.recognized({
      text: "second",
      locale: "fr-FR",
      final: true,
    });
    await Promise.resolve();
    expect(maxActive).toBe(1);
    expect(releases).toHaveLength(1);
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(
      send.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "subtitle.final")
        .map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("closes when a seventeenth segment is queued behind active work", async () => {
    const { createSessionOrchestrator } = await load();
    let release!: () => void;
    const close = vi.fn();
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const orchestrator = createSessionOrchestrator({
      translate: async function* () {
        await held;
        yield "完成";
      },
      send: vi.fn(),
      close,
    });
    const work = [
      orchestrator.recognized({
        text: "active",
        locale: "en-US",
        final: true,
      }),
    ];
    await Promise.resolve();
    for (let index = 0; index < 16; index += 1) {
      work.push(
        orchestrator.recognized({
          text: `queued-${index}`,
          locale: "en-US",
          final: true,
        }),
      );
    }
    await orchestrator.recognized({
      text: "overflow",
      locale: "en-US",
      final: true,
    });
    expect(close).toHaveBeenCalledWith(1011);
    release();
    await Promise.all(work);
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
