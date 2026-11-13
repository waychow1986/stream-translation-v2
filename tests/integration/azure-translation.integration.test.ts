import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type IntegrationAdapters = {
  recognizeFixture(input: {
    audio: Uint8Array;
    expectedLocale: string | null;
    languageCandidates: string[];
    environment: Record<string, string>;
  }): Promise<{
    status: "recognized" | "unrecognized";
    locale?: string;
    text?: string;
    requestId?: string;
  }>;
  probeAndTranslate(input: {
    text: string;
    environment: Record<string, string>;
  }): Promise<{
    probe: "passed";
    deltas: string[];
    completed: boolean;
    requestId?: string;
    requestContract: {
      model: string;
      stream: boolean;
      reasoning: { effort: string };
    };
  }>;
};

const enabled = process.env["AZURE_TRANSLATION_INTEGRATION"] === "1";
const requiredKeys = [
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_LANGUAGE_CANDIDATES",
  "AZURE_FOUNDRY_ENDPOINT",
  "AZURE_FOUNDRY_MODEL_DEPLOYMENT",
] as const;

function integrationEnvironment(): Record<string, string> {
  const missing = requiredKeys.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `AZURE_TRANSLATION_INTEGRATION=1 requires: ${missing.join(", ")}`,
    );
  }
  return Object.fromEntries(
    requiredKeys.map((key) => [key, process.env[key] as string]),
  );
}

async function loadAdapters(): Promise<IntegrationAdapters> {
  const modulePath = "../../src/server/adapters/speech-recognizer.js";
  const speech = (await import(modulePath)) as Partial<IntegrationAdapters>;
  const foundryPath = "../../src/server/adapters/foundry-translator.js";
  const foundry = (await import(foundryPath)) as Partial<IntegrationAdapters>;
  if (!speech.recognizeFixture || !foundry.probeAndTranslate) {
    throw new Error("Azure integration adapter entry points are unavailable");
  }
  return {
    recognizeFixture: speech.recognizeFixture,
    probeAndTranslate: foundry.probeAndTranslate,
  };
}

describe.runIf(enabled)("real Azure translation integration", () => {
  it("uses the configured continuous-LID candidate range for two languages", async () => {
    const environment = integrationEnvironment();
    const adapters = await loadAdapters();
    const candidates = environment[
      "AZURE_SPEECH_LANGUAGE_CANDIDATES"
    ]!.split(",");
    const fixtures = [
      ["recognized-language-a.wav", "en-US"],
      ["recognized-language-b.wav", "fr-FR"],
    ] as const;

    for (const [file, expectedLocale] of fixtures) {
      const audio = await readFile(
        new URL(`../fixtures/audio/${file}`, import.meta.url),
      );
      const result = await adapters.recognizeFixture({
        audio,
        expectedLocale,
        languageCandidates: candidates,
        environment,
      });
      expect(result).toMatchObject({
        status: "recognized",
        locale: expectedLocale,
      });
      expect(result.text?.trim()).toBeTruthy();
    }
  });

  it("maps the approved unrecognized fixture without successful text", async () => {
    const environment = integrationEnvironment();
    const adapters = await loadAdapters();
    const audio = await readFile(
      new URL("../fixtures/audio/unrecognized.wav", import.meta.url),
    );
    const result = await adapters.recognizeFixture({
      audio,
      expectedLocale: null,
      languageCandidates: environment[
        "AZURE_SPEECH_LANGUAGE_CANDIDATES"
      ]!.split(","),
      environment,
    });
    expect(result).toMatchObject({ status: "unrecognized" });
    expect(result.text).toBeUndefined();
  });

  it("probes and streams gpt-sol-6.1 with reasoning disabled", async () => {
    const environment = integrationEnvironment();
    expect(environment["AZURE_FOUNDRY_MODEL_DEPLOYMENT"]).toBe("gpt-sol-6.1");
    const adapters = await loadAdapters();
    const result = await adapters.probeAndTranslate({
      text: "The meeting has started.",
      environment,
    });
    expect(result).toMatchObject({
      probe: "passed",
      completed: true,
      requestContract: {
        model: "gpt-sol-6.1",
        stream: true,
        reasoning: { effort: "none" },
      },
    });
    expect(result.deltas.some((delta) => delta.length > 0)).toBe(true);
  });
});
