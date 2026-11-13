import { Ajv } from "ajv";

export const TRANSLATION_SUBPROTOCOL = "translation.v1";
export const PROTOCOL_VERSION = 1 as const;

export const AUDIO_FORMAT = {
  encoding: "pcm_s16le",
  sampleRateHz: 16_000,
  channels: 1,
} as const;
export const AUDIO_FRAME_BYTES = 3_200;

export const CLOSE_CODES = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  policyViolation: 1008,
  internalError: 1011,
} as const;

export const SEGMENT_FAILURE_CATEGORIES = [
  "speech_authentication",
  "speech_configuration",
  "speech_connection",
  "translation_authentication",
  "translation_configuration",
  "translation_connection",
  "translation_contract",
  "resource_exhausted",
  "internal",
] as const;

export const SESSION_CLOSE_REASONS = [
  "client_stop",
  "disconnect",
  "server_draining",
  "protocol_error",
  "policy_violation",
  "external_failure",
] as const;

export type SegmentFailureCategory =
  (typeof SEGMENT_FAILURE_CATEGORIES)[number];
export type SessionCloseReason = (typeof SESSION_CLOSE_REASONS)[number];

type ProtocolEvent = {
  protocolVersion: typeof PROTOCOL_VERSION;
};

export type SessionStartEvent = ProtocolEvent & {
  type: "session.start";
  audio: typeof AUDIO_FORMAT;
};

export type SessionStopEvent = ProtocolEvent & {
  type: "session.stop";
  sessionId: string;
};

export type ClientControlEvent = SessionStartEvent | SessionStopEvent;

type SessionEvent = ProtocolEvent & {
  sessionId: string;
};

type SegmentEvent = SessionEvent & {
  segmentId: string;
  sequence: number;
};

export type SessionReadyEvent = SessionEvent & {
  type: "session.ready";
};

export type SegmentDetectedEvent = SegmentEvent & {
  type: "segment.detected";
  sourceLocale: string;
};

export type SubtitleDeltaEvent = SegmentEvent & {
  type: "subtitle.delta";
  revision: number;
  text: string;
  isFinal: false;
};

export type SubtitleFinalEvent = SegmentEvent & {
  type: "subtitle.final";
  revision: number;
  text: string;
  isFinal: true;
};

export type SegmentUnrecognizedEvent = SegmentEvent & {
  type: "segment.unrecognized";
};

export type SegmentFailedEvent = SegmentEvent & {
  type: "segment.failed";
  category: SegmentFailureCategory;
};

export type SessionClosedEvent = SessionEvent & {
  type: "session.closed";
  reason: SessionCloseReason;
};

export type ServerEvent =
  | SessionReadyEvent
  | SegmentDetectedEvent
  | SubtitleDeltaEvent
  | SubtitleFinalEvent
  | SegmentUnrecognizedEvent
  | SegmentFailedEvent
  | SessionClosedEvent;

export type TerminalServerEvent =
  | SubtitleFinalEvent
  | SegmentUnrecognizedEvent
  | SegmentFailedEvent
  | SessionClosedEvent;

const uuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const segmentIdPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$";

const baseProperties = {
  protocolVersion: { const: PROTOCOL_VERSION },
} as const;
const sessionProperties = {
  ...baseProperties,
  sessionId: { type: "string", pattern: uuidPattern },
} as const;
const segmentProperties = {
  ...sessionProperties,
  segmentId: { type: "string", pattern: segmentIdPattern },
  sequence: { type: "integer", minimum: 1 },
} as const;

export const clientControlEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "protocolVersion", "audio"],
      properties: {
        ...baseProperties,
        type: { const: "session.start" },
        audio: {
          type: "object",
          additionalProperties: false,
          required: ["encoding", "sampleRateHz", "channels"],
          properties: {
            encoding: { const: AUDIO_FORMAT.encoding },
            sampleRateHz: { const: AUDIO_FORMAT.sampleRateHz },
            channels: { const: AUDIO_FORMAT.channels },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "protocolVersion", "sessionId"],
      properties: {
        ...sessionProperties,
        type: { const: "session.stop" },
      },
    },
  ],
} as const;

export const serverEventSchema = {
  oneOf: [
    objectSchema("session.ready", sessionProperties),
    objectSchema("segment.detected", segmentProperties, {
      sourceLocale: {
        type: "string",
        pattern: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$",
      },
    }),
    objectSchema("subtitle.delta", segmentProperties, {
      revision: { type: "integer", minimum: 1 },
      text: { type: "string", minLength: 1 },
      isFinal: { const: false },
    }),
    objectSchema("subtitle.final", segmentProperties, {
      revision: { type: "integer", minimum: 1 },
      text: { type: "string", minLength: 1 },
      isFinal: { const: true },
    }),
    objectSchema("segment.unrecognized", segmentProperties),
    objectSchema("segment.failed", segmentProperties, {
      category: { enum: SEGMENT_FAILURE_CATEGORIES },
    }),
    objectSchema("session.closed", sessionProperties, {
      reason: { enum: SESSION_CLOSE_REASONS },
    }),
  ],
} as const;

function objectSchema(
  type: ServerEvent["type"],
  commonProperties: Record<string, unknown>,
  eventProperties: Record<string, unknown> = {},
) {
  const properties = {
    ...commonProperties,
    type: { const: type },
    ...eventProperties,
  };

  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const ajv = new Ajv({ allErrors: true, strict: true });
const clientControlValidator = ajv.compile(clientControlEventSchema);
const serverEventValidator = ajv.compile(serverEventSchema);

export function validateClientControlEvent(
  value: unknown,
): value is ClientControlEvent {
  return clientControlValidator(value);
}

export function validateServerEvent(value: unknown): value is ServerEvent {
  if (!serverEventValidator(value)) {
    return false;
  }

  if ("segmentId" in value) {
    return value.segmentId === `${value.sessionId}:${value.sequence}`;
  }

  return true;
}

export function validateAudioFrame(value: unknown): boolean {
  const byteLength =
    value instanceof ArrayBuffer
      ? value.byteLength
      : ArrayBuffer.isView(value)
        ? value.byteLength
        : 0;

  return byteLength > 0 && byteLength <= AUDIO_FRAME_BYTES;
}

export function isTerminalServerEvent(
  event: ServerEvent,
): event is TerminalServerEvent {
  return (
    event.type === "subtitle.final" ||
    event.type === "segment.unrecognized" ||
    event.type === "segment.failed" ||
    event.type === "session.closed"
  );
}
