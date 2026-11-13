import type { ServerEvent } from "../../shared/protocol.js";

export type SubtitleState = {
  segments: Array<{
    sequence: number;
    revision: number;
    text?: string;
    sourceLocale?: string;
    terminal: boolean;
    status?: "unrecognized" | "failed";
  }>;
  closeRequired: boolean;
};

export const initialSubtitleState: SubtitleState = {
  segments: [],
  closeRequired: false,
};

export function reduceSubtitle(
  state: SubtitleState,
  event: ServerEvent,
): SubtitleState {
  if (state.closeRequired || !("sequence" in event)) return state;
  const existing = state.segments.find(
    ({ sequence }) => sequence === event.sequence,
  );
  const maximum = state.segments.reduce(
    (value, segment) => Math.max(value, segment.sequence),
    0,
  );
  if (!existing && event.sequence > maximum + 1) {
    return { ...state, closeRequired: true };
  }
  if (event.type === "segment.detected") {
    if (existing) return state;
    return {
      ...state,
      segments: [
        ...state.segments,
        {
          sequence: event.sequence,
          revision: 0,
          sourceLocale: event.sourceLocale,
          terminal: false,
        },
      ],
    };
  }
  if (
    event.type !== "subtitle.delta" &&
    event.type !== "subtitle.final" &&
    event.type !== "segment.unrecognized" &&
    event.type !== "segment.failed"
  ) {
    return state;
  }
  if (
    existing?.terminal ||
    ("revision" in event && existing && event.revision <= existing.revision)
  ) {
    return state;
  }
  const replacement = {
    sequence: event.sequence,
    revision: "revision" in event ? event.revision : 0,
    ...("text" in event ? { text: event.text } : {}),
    ...(existing?.sourceLocale
      ? { sourceLocale: existing.sourceLocale }
      : {}),
    terminal: event.type !== "subtitle.delta",
    ...(event.type === "segment.unrecognized"
      ? { status: "unrecognized" as const }
      : event.type === "segment.failed"
        ? { status: "failed" as const }
        : {}),
  };
  return {
    ...state,
    segments: existing
      ? state.segments.map((segment) =>
          segment.sequence === event.sequence ? replacement : segment,
        )
      : [...state.segments, replacement],
  };
}
