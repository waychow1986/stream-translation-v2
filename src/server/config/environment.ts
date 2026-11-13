export type AppEnvironment = {
  port: number;
  appOrigin: string;
  speechRegion: string;
  speechLanguageCandidates: string[];
  foundryEndpoint: string;
  foundryDeployment: "gpt-sol-6.1";
};

const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$/;

export function parseEnvironment(
  input: Record<string, string | undefined>,
): AppEnvironment {
  const required = [
    "PORT",
    "APP_ORIGIN",
    "AZURE_SPEECH_REGION",
    "AZURE_SPEECH_LANGUAGE_CANDIDATES",
    "AZURE_FOUNDRY_ENDPOINT",
    "AZURE_FOUNDRY_MODEL_DEPLOYMENT",
  ] as const;
  const missing = required.filter((key) => !input[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing configuration: ${missing.join(", ")}`);
  }
  const port = Number(input["PORT"]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid configuration: PORT");
  }
  let origin: URL;
  let foundryEndpoint: URL;
  try {
    origin = new URL(input["APP_ORIGIN"]!);
    foundryEndpoint = new URL(input["AZURE_FOUNDRY_ENDPOINT"]!);
  } catch {
    throw new Error("Invalid endpoint configuration");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== input["APP_ORIGIN"] ||
    foundryEndpoint.protocol !== "https:"
  ) {
    throw new Error("Invalid endpoint configuration");
  }
  const candidates = input["AZURE_SPEECH_LANGUAGE_CANDIDATES"]!
    .split(",")
    .map((locale) => locale.trim());
  if (
    candidates.length === 0 ||
    candidates.some(
      (locale) =>
        !localePattern.test(locale) ||
        locale.toLowerCase().startsWith("zh-"),
    ) ||
    new Set(candidates).size !== candidates.length
  ) {
    throw new Error(
      "Invalid configuration: AZURE_SPEECH_LANGUAGE_CANDIDATES",
    );
  }
  if (input["AZURE_FOUNDRY_MODEL_DEPLOYMENT"] !== "gpt-sol-6.1") {
    throw new Error(
      "Invalid configuration: AZURE_FOUNDRY_MODEL_DEPLOYMENT",
    );
  }
  return {
    port,
    appOrigin: origin.origin,
    speechRegion: input["AZURE_SPEECH_REGION"]!,
    speechLanguageCandidates: candidates,
    foundryEndpoint: foundryEndpoint.origin,
    foundryDeployment: "gpt-sol-6.1",
  };
}
