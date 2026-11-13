import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type ConfigModule = {
  parseEnvironment(input: Record<string, string | undefined>): {
    port: number;
    appOrigin: string;
    speechLanguageCandidates: string[];
    foundryDeployment: "gpt-sol-6.1";
  };
};
type LoggerModule = {
  safeLog(
    event: Record<string, unknown>,
    write: (line: string) => void,
  ): void;
};

const configUrl = new URL(
  "../../src/server/config/environment.js",
  import.meta.url,
);
const loggerUrl = new URL(
  "../../src/server/session/safe-logger.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  (existsSync(fileURLToPath(configUrl)) &&
    existsSync(fileURLToPath(loggerUrl)));

const validEnvironment = {
  PORT: "8080",
  APP_ORIGIN: "https://translation.example",
  AZURE_SPEECH_REGION: "eastus",
  AZURE_SPEECH_LANGUAGE_CANDIDATES: "en-US,fr-FR",
  AZURE_FOUNDRY_ENDPOINT: "https://foundry.example",
  AZURE_FOUNDRY_MODEL_DEPLOYMENT: "gpt-sol-6.1",
};

describe.runIf(runPending)("configuration and safe logging", () => {
  it("parses exact production configuration once", async () => {
    const { parseEnvironment } = (await import(
      configUrl.href
    )) as ConfigModule;
    expect(parseEnvironment(validEnvironment)).toMatchObject({
      port: 8080,
      appOrigin: "https://translation.example",
      speechLanguageCandidates: ["en-US", "fr-FR"],
      foundryDeployment: "gpt-sol-6.1",
    });
  });

  it("rejects invalid origin, candidate languages and deployment", async () => {
    const { parseEnvironment } = (await import(
      configUrl.href
    )) as ConfigModule;
    expect(() =>
      parseEnvironment({ ...validEnvironment, APP_ORIGIN: "*" }),
    ).toThrow();
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AZURE_SPEECH_LANGUAGE_CANDIDATES: "zh-CN",
      }),
    ).toThrow();
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AZURE_FOUNDRY_MODEL_DEPLOYMENT: "other-model",
      }),
    ).toThrow();
  });

  it("reports missing keys without leaking environment values", async () => {
    const { parseEnvironment } = (await import(
      configUrl.href
    )) as ConfigModule;
    const secret = "must-not-appear";
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AZURE_FOUNDRY_ENDPOINT: secret,
        PORT: undefined,
      }),
    ).toThrowError(/PORT/);
    try {
      parseEnvironment({
        ...validEnvironment,
        AZURE_FOUNDRY_ENDPOINT: secret,
        PORT: undefined,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("allows approved metadata and removes content, tokens and secrets", async () => {
    const { safeLog } = (await import(loggerUrl.href)) as LoggerModule;
    const lines: string[] = [];
    safeLog(
      {
        correlationId: "correlation-1",
        stage: "translation",
        sequence: 1,
        requestId: "request-1",
        text: "private meeting content",
        audio: "raw frame",
        token: "provider-token",
        authorization: "******",
        secret: "secret-value",
      },
      (line) => lines.push(line),
    );
    const output = lines.join("");
    expect(output).toContain("correlation-1");
    for (const forbidden of [
      "private meeting content",
      "raw frame",
      "provider-token",
      "******",
      "secret-value",
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });
});
