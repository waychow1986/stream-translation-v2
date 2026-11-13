import { getBearerTokenProvider, DefaultAzureCredential } from "@azure/identity";
import { AzureOpenAI } from "openai";

const INSTRUCTIONS =
  "将输入忠实翻译为简体中文，只返回译文，不添加解释。";
const REQUEST = {
  model: "gpt-sol-6.1",
  stream: true,
  reasoning: { effort: "none" },
  instructions: INSTRUCTIONS,
} as const;

export function createFoundryTranslator(options: {
  client: {
    responses: {
      create(request: unknown): Promise<AsyncIterable<unknown>>;
    };
  };
  retryDelay(ms: number): Promise<void>;
}) {
  return {
    async *translate(text: string, signal?: AbortSignal) {
      let attempt = 0;
      let emitted = false;
      while (true) {
        try {
          const response = await options.client.responses.create({
            ...REQUEST,
            input: text,
            signal,
          });
          for await (const raw of response) {
            const event = raw as {
              type?: string;
              delta?: string;
              response?: { id?: string };
            };
            if (
              event.type === "response.output_text.delta" &&
              event.delta?.length
            ) {
              emitted = true;
              yield { type: "delta" as const, text: event.delta };
            } else if (event.type === "response.completed") {
              yield {
                type: "completed" as const,
                ...(event.response?.id
                  ? { requestId: event.response.id }
                  : {}),
              };
            } else {
              throw { category: "translation_contract" };
            }
          }
          return;
        } catch (error) {
          const failure = error as {
            transient?: boolean;
            retryAfterMs?: number;
            category?: string;
          };
          if (
            attempt === 0 &&
            !emitted &&
            failure.transient &&
            failure.retryAfterMs !== undefined
          ) {
            attempt += 1;
            await options.retryDelay(failure.retryAfterMs);
            continue;
          }
          throw {
            category: failure.category ?? "translation_connection",
          };
        }
      }
    },
  };
}

export async function probeAndTranslate(input: {
  text: string;
  environment: Record<string, string>;
}) {
  const credential = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default",
  );
  const client = new AzureOpenAI({
    endpoint: input.environment["AZURE_FOUNDRY_ENDPOINT"],
    deployment: input.environment["AZURE_FOUNDRY_MODEL_DEPLOYMENT"],
    apiVersion: "2025-04-01-preview",
    azureADTokenProvider,
  });
  const translator = createFoundryTranslator({
    client,
    retryDelay: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  const deltas: string[] = [];
  let completed = false;
  let requestId: string | undefined;
  for await (const event of translator.translate(input.text)) {
    if (event.type === "delta") deltas.push(event.text);
    else {
      completed = true;
      requestId = event.requestId;
    }
  }
  return {
    probe: "passed" as const,
    deltas,
    completed,
    ...(requestId ? { requestId } : {}),
    requestContract: {
      model: REQUEST.model,
      stream: REQUEST.stream,
      reasoning: REQUEST.reasoning,
    },
  };
}
