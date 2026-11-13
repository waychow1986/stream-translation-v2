import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

type FoundryModule = {
  createFoundryTranslator(options: {
    client: { responses: { create(request: unknown): Promise<AsyncIterable<unknown>> } };
    retryDelay(ms: number): Promise<void>;
  }): {
    translate(text: string, signal?: AbortSignal): AsyncIterable<
      | { type: "delta"; text: string }
      | { type: "completed"; requestId?: string }
    >;
  };
};

const moduleUrl = new URL(
  "../../src/server/adapters/foundry-translator.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

async function* events(...values: unknown[]): AsyncIterable<unknown> {
  yield* values;
}

describe.runIf(runPending)("Foundry translation adapter contract", () => {
  async function load(): Promise<FoundryModule> {
    return (await import(moduleUrl.href)) as FoundryModule;
  }

  it("locks model, Chinese instruction, streaming and disabled reasoning", async () => {
    const { createFoundryTranslator } = await load();
    const create = vi.fn(async () =>
      events(
        { type: "response.output_text.delta", delta: "会" },
        { type: "response.completed", response: { id: "request-1" } },
      ),
    );
    const translator = createFoundryTranslator({
      client: { responses: { create } },
      retryDelay: vi.fn(),
    });
    const output = [];
    for await (const event of translator.translate("The meeting")) {
      output.push(event);
    }
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-sol-6.1",
        stream: true,
        reasoning: { effort: "none" },
        input: "The meeting",
        instructions: expect.stringMatching(/简体中文/),
      }),
    );
    expect(output).toEqual([
      { type: "delta", text: "会" },
      { type: "completed", requestId: "request-1" },
    ]);
  });

  it("fails closed on unknown stream events", async () => {
    const { createFoundryTranslator } = await load();
    const translator = createFoundryTranslator({
      client: {
        responses: { create: async () => events({ type: "unknown" }) },
      },
      retryDelay: vi.fn(),
    });
    await expect(async () => {
      for await (const _event of translator.translate("text")) {
        // Consume the stream.
      }
    }).rejects.toMatchObject({ category: "translation_contract" });
  });

  it("retries one transient pre-delta failure only when a delay is supplied", async () => {
    const { createFoundryTranslator } = await load();
    const create = vi
      .fn()
      .mockRejectedValueOnce({ transient: true, retryAfterMs: 1 })
      .mockResolvedValueOnce(
        events({ type: "response.completed", response: { id: "request-2" } }),
      );
    const retryDelay = vi.fn(async () => undefined);
    const translator = createFoundryTranslator({
      client: { responses: { create } },
      retryDelay,
    });
    for await (const _event of translator.translate("text")) {
      // Consume the stream.
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(1);
  });
});
