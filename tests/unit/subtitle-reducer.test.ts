import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ServerEvent } from "../../src/shared/protocol.js";

type SubtitleState = {
  segments: Array<{
    sequence: number;
    revision: number;
    text?: string;
    terminal: boolean;
  }>;
  closeRequired: boolean;
};
type ReducerModule = {
  initialSubtitleState: SubtitleState;
  reduceSubtitle(state: SubtitleState, event: ServerEvent): SubtitleState;
};

const sessionId = "9a7f62d0-724a-4f15-9c2c-8e54df9c91c5";
const moduleUrl = new URL(
  "../../src/client/protocol/subtitle-reducer.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

describe.runIf(runPending)("subtitle reducer", () => {
  async function load(): Promise<ReducerModule> {
    return (await import(moduleUrl.href)) as ReducerModule;
  }

  function subtitle(
    type: "subtitle.delta" | "subtitle.final",
    sequence: number,
    revision: number,
    text: string,
  ): ServerEvent {
    return {
      type,
      protocolVersion: 1,
      sessionId,
      segmentId: `${sessionId}:${sequence}`,
      sequence,
      revision,
      text,
      isFinal: type === "subtitle.final",
    } as ServerEvent;
  }

  it("replaces a segment by increasing revision and makes final terminal", async () => {
    const { initialSubtitleState, reduceSubtitle } = await load();
    let state = reduceSubtitle(
      initialSubtitleState,
      subtitle("subtitle.delta", 1, 1, "会"),
    );
    state = reduceSubtitle(state, subtitle("subtitle.delta", 1, 2, "会议"));
    state = reduceSubtitle(
      state,
      subtitle("subtitle.final", 1, 3, "会议开始"),
    );
    expect(state.segments).toEqual([
      { sequence: 1, revision: 3, text: "会议开始", terminal: true },
    ]);
  });

  it("ignores duplicate, old and post-final events", async () => {
    const { initialSubtitleState, reduceSubtitle } = await load();
    const final = reduceSubtitle(
      initialSubtitleState,
      subtitle("subtitle.final", 1, 2, "会议"),
    );
    expect(
      reduceSubtitle(final, subtitle("subtitle.delta", 1, 3, "迟到")).segments,
    ).toEqual(final.segments);
    expect(
      reduceSubtitle(final, subtitle("subtitle.final", 1, 1, "旧")).segments,
    ).toEqual(final.segments);
  });

  it("requires connection close on a sequence gap", async () => {
    const { initialSubtitleState, reduceSubtitle } = await load();
    expect(
      reduceSubtitle(
        initialSubtitleState,
        subtitle("subtitle.delta", 2, 1, "跳号"),
      ).closeRequired,
    ).toBe(true);
  });
});
