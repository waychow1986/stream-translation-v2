import { describe, expect, it } from "vitest";

import {
  AUDIO_FRAME_BYTES,
  CLOSE_CODES,
  PROTOCOL_VERSION,
  TRANSLATION_SUBPROTOCOL,
  isTerminalServerEvent,
  validateAudioFrame,
  validateClientControlEvent,
  validateServerEvent,
} from "../../src/shared/protocol.js";

const sessionId = "9a7f62d0-724a-4f15-9c2c-8e54df9c91c5";
const segmentId = `${sessionId}:1`;

describe("translation.v1 protocol", () => {
  it("locks protocol and close-code constants", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TRANSLATION_SUBPROTOCOL).toBe("translation.v1");
    expect(CLOSE_CODES).toEqual({
      normal: 1000,
      goingAway: 1001,
      protocolError: 1002,
      policyViolation: 1008,
      internalError: 1011,
    });
  });

  it.each([
    {
      type: "session.start",
      protocolVersion: 1,
      audio: {
        encoding: "pcm_s16le",
        sampleRateHz: 16_000,
        channels: 1,
      },
    },
    { type: "session.stop", protocolVersion: 1, sessionId },
  ])("accepts client event $type", (event) => {
    expect(validateClientControlEvent(event)).toBe(true);
  });

  it.each([
    { type: "session.ready", protocolVersion: 1, sessionId },
    {
      type: "segment.detected",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      sourceLocale: "en-US",
    },
    {
      type: "subtitle.delta",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      revision: 1,
      text: "会",
      isFinal: false,
    },
    {
      type: "subtitle.final",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      revision: 2,
      text: "会议",
      isFinal: true,
    },
    {
      type: "segment.unrecognized",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
    },
    {
      type: "segment.failed",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      category: "translation_contract",
    },
    {
      type: "session.closed",
      protocolVersion: 1,
      sessionId,
      reason: "client_stop",
    },
  ])("accepts server event $type", (event) => {
    expect(validateServerEvent(event)).toBe(true);
  });

  it.each([
    { type: "session.unknown", protocolVersion: 1 },
    {
      type: "session.start",
      protocolVersion: 1,
      audio: {
        encoding: "pcm_s16le",
        sampleRateHz: 16_000,
        channels: 1,
      },
      unexpected: true,
    },
    { type: "session.stop", protocolVersion: 2, sessionId },
    { type: "session.stop", protocolVersion: 1, sessionId: "not-a-uuid" },
  ])("rejects invalid client control event %#", (event) => {
    expect(validateClientControlEvent(event)).toBe(false);
  });

  it.each([
    { type: "unknown", protocolVersion: 1, sessionId },
    {
      type: "session.ready",
      protocolVersion: 1,
      sessionId,
      unexpected: true,
    },
    {
      type: "segment.detected",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 0,
      sourceLocale: "en-US",
    },
    {
      type: "subtitle.delta",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      revision: 0,
      text: "会",
      isFinal: false,
    },
    {
      type: "segment.unrecognized",
      protocolVersion: 1,
      sessionId,
      segmentId: `${sessionId}:2`,
      sequence: 1,
    },
    {
      type: "subtitle.final",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      revision: 1,
      text: "会议",
      isFinal: false,
    },
    {
      type: "segment.failed",
      protocolVersion: 1,
      sessionId,
      segmentId,
      sequence: 1,
      category: "provider raw error",
    },
    {
      type: "session.closed",
      protocolVersion: 1,
      sessionId,
      reason: "unknown",
    },
  ])("rejects invalid server event %#", (event) => {
    expect(validateServerEvent(event)).toBe(false);
  });

  it("validates binary PCM frame boundaries", () => {
    expect(validateAudioFrame(new Uint8Array(AUDIO_FRAME_BYTES))).toBe(true);
    expect(validateAudioFrame(new Uint8Array(640))).toBe(true);
    expect(validateAudioFrame(new Uint8Array())).toBe(false);
    expect(validateAudioFrame(new Uint8Array(AUDIO_FRAME_BYTES + 1))).toBe(
      false,
    );
    expect(validateAudioFrame("binary-looking text")).toBe(false);
  });

  it("identifies only event terminal states", () => {
    const event = {
      protocolVersion: 1 as const,
      sessionId,
      segmentId,
      sequence: 1,
    };

    expect(
      isTerminalServerEvent({
        ...event,
        type: "segment.unrecognized",
      }),
    ).toBe(true);
    expect(
      isTerminalServerEvent({
        ...event,
        type: "subtitle.final",
        revision: 1,
        text: "会议",
        isFinal: true,
      }),
    ).toBe(true);
    expect(
      isTerminalServerEvent({
        ...event,
        type: "subtitle.delta",
        revision: 1,
        text: "会",
        isFinal: false,
      }),
    ).toBe(false);
  });
});
