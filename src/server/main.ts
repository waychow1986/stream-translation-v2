import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { AzureOpenAI } from "openai";

import { createFoundryTranslator } from "./adapters/foundry-translator.js";
import { createProductionSpeechRecognizer } from "./adapters/speech-recognizer.js";
import { runStartupContractProbe } from "./adapters/startup-contract.js";
import {
  parseEnvironment,
  type AppEnvironment,
} from "./config/environment.js";
import { registerReadinessRoute } from "./routes/readiness.js";
import { registerTranslationWebsocket } from "./routes/translation-websocket.js";
import {
  createRecoveringSpeechConnection,
  createSessionOrchestrator,
} from "./session/orchestrator.js";

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
    createSession(send, close) {
      const sessionId = randomUUID();
      const orchestrator = createSessionOrchestrator({
        sessionId,
        send,
        close,
        translate: async function* (text, signal) {
          for await (const event of translator.translate(text, signal)) {
            if (event.type === "delta") yield event.text;
          }
        },
      });
      const connection = createRecoveringSpeechConnection({
        close,
        async createRecognizer() {
          const speechConfig = await createSpeechConfig(config);
          return createProductionSpeechRecognizer({
            sdk: SpeechSDK,
            speechConfig,
            locales: config.speechLanguageCandidates,
            callbacks: {
              recognized(event) {
                void orchestrator.recognized({ ...event, final: true });
              },
              unrecognized() {
                void orchestrator.unrecognized();
              },
              canceled(event) {
                void connection.canceled(event);
              },
            },
          });
        },
      });
      return {
        async start() {
          await connection.start();
          return { sessionId };
        },
        write(frame) {
          connection.write(frame);
        },
        async stop() {
          await connection.stop();
          await orchestrator.stop();
        },
        dispose() {
          void connection.stop();
          orchestrator.abort();
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
