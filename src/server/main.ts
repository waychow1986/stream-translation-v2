import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { AzureOpenAI } from "openai";

import { createFoundryTranslator } from "./adapters/foundry-translator.js";
import { runStartupContractProbe } from "./adapters/startup-contract.js";
import {
  parseEnvironment,
  type AppEnvironment,
} from "./config/environment.js";
import { registerReadinessRoute } from "./routes/readiness.js";
import { registerTranslationWebsocket } from "./routes/translation-websocket.js";
import { createSessionOrchestrator } from "./session/orchestrator.js";

type ProbeState = {
  probe: "pending" | "passed" | "failed";
  draining: boolean;
};

function createFoundryClient(config: AppEnvironment) {
  const azureADTokenProvider = getBearerTokenProvider(
    new DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default",
  );
  return new AzureOpenAI({
    endpoint: config.foundryEndpoint,
    deployment: config.foundryDeployment,
    apiVersion: "2025-04-01-preview",
    azureADTokenProvider,
  });
}

async function createSpeechConfig(config: AppEnvironment) {
  const subscriptionKey = process.env["AZURE_SPEECH_KEY"]?.trim();
  if (subscriptionKey) {
    return SpeechSDK.SpeechConfig.fromSubscription(
      subscriptionKey,
      config.speechRegion,
    );
  }
  const token = await new DefaultAzureCredential().getToken(
    "https://cognitiveservices.azure.com/.default",
  );
  if (!token) throw new Error("Unable to acquire Azure Speech identity");
  return SpeechSDK.SpeechConfig.fromAuthorizationToken(
    token.token,
    config.speechRegion,
  );
}

export async function buildApplication(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseEnvironment(environment);
  const app = Fastify({ logger: false });
  const state: ProbeState = { probe: "pending", draining: false };
  const foundryClient = createFoundryClient(config);
  const translator = createFoundryTranslator({
    client: foundryClient,
    retryDelay: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });

  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../../dist/client", import.meta.url)),
  });
  registerReadinessRoute(app, state);
  app.get("/candidate-identity", async (_request, reply) => {
    const deliveryId = process.env["AIDELIVERY_DELIVERY_ID"];
    const candidateSha = process.env["AIDELIVERY_CANDIDATE_SHA"];
    if (!deliveryId || !candidateSha) {
      return reply.code(503).send({ status: "identity_unavailable" });
    }
    return { deliveryId, candidateSha };
  });
  registerTranslationWebsocket(app, {
    expectedOrigin: config.appOrigin,
    isDraining: () => state.draining,
    createSession(send) {
      const sessionId = randomUUID();
      let pushStream: SpeechSDK.PushAudioInputStream | undefined;
      let recognizer: SpeechSDK.SpeechRecognizer | undefined;
      const orchestrator = createSessionOrchestrator({
        sessionId,
        send,
        translate: async function* (text, signal) {
          for await (const event of translator.translate(text, signal)) {
            if (event.type === "delta") yield event.text;
          }
        },
      });
      return {
        async start() {
          const speechConfig = await createSpeechConfig(config);
          const autoDetect =
            SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(
              config.speechLanguageCandidates,
            );
          const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(
            16_000,
            16,
            1,
          );
          pushStream = SpeechSDK.AudioInputStream.createPushStream(format);
          recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
            speechConfig,
            autoDetect,
            SpeechSDK.AudioConfig.fromStreamInput(pushStream),
          );
          recognizer.recognized = (_sender, event) => {
            const text = event.result.text?.trim();
            if (!text) {
              void orchestrator.unrecognized();
              return;
            }
            const locale =
              SpeechSDK.AutoDetectSourceLanguageResult.fromResult(event.result)
                .language;
            void orchestrator.recognized({
              text,
              locale,
              final: true,
            });
          };
          await new Promise<void>((resolve, reject) =>
            recognizer!.startContinuousRecognitionAsync(resolve, reject),
          );
          return { sessionId };
        },
        write(frame) {
          pushStream?.write(frame.slice().buffer as ArrayBuffer);
        },
        async stop() {
          pushStream?.close();
          if (recognizer) {
            await new Promise<void>((resolve) =>
              recognizer!.stopContinuousRecognitionAsync(resolve, () =>
                resolve(),
              ),
            );
            recognizer.close();
          }
          await orchestrator.stop();
        },
        dispose() {
          pushStream?.close();
          recognizer?.close();
          orchestrator.abort();
          pushStream = undefined;
          recognizer = undefined;
        },
      };
    },
  });

  const probe = await runStartupContractProbe({
    stream: async function* (request) {
      const response = await foundryClient.responses.create(
        request as Parameters<typeof foundryClient.responses.create>[0],
      );
      for await (const event of response as AsyncIterable<unknown>) {
        yield event;
      }
    },
  });
  state.probe = probe.status;

  const drain = async () => {
    state.draining = true;
    await app.close();
  };
  process.once("SIGTERM", () => void drain());
  return { app, config, state, drain };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { app, config } = await buildApplication();
  await app.listen({ host: "0.0.0.0", port: config.port });
}
