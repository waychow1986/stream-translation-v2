const ALLOWED_FIELDS = new Set([
  "timestamp",
  "level",
  "correlationId",
  "sessionHash",
  "stage",
  "category",
  "sourceLocale",
  "sequence",
  "requestId",
  "durationMs",
  "closeCategory",
]);

export function safeLog(
  event: Record<string, unknown>,
  write: (line: string) => void = (line) => process.stdout.write(line),
) {
  const safe = Object.fromEntries(
    Object.entries(event).filter(
      ([key, value]) =>
        ALLOWED_FIELDS.has(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    ),
  );
  write(`${JSON.stringify(safe)}\n`);
}
