const PROBE_INPUT = "The meeting has started.";

export async function runStartupContractProbe(port: {
  stream(request: unknown): AsyncIterable<unknown>;
}): Promise<{ status: "passed" | "failed"; category?: string }> {
  let delta = false;
  let completed = false;
  try {
    for await (const raw of port.stream({
      model: "gpt-sol-6.1",
      input: PROBE_INPUT,
      instructions: "将输入忠实翻译为简体中文，只返回译文，不添加解释。",
      stream: true,
      reasoning: { effort: "none" },
    })) {
      const event = raw as { type?: string; delta?: string };
      if (
        event.type === "response.output_text.delta" &&
        event.delta?.length
      ) {
        delta = true;
      } else if (event.type === "response.completed") {
        completed = true;
      } else {
        return { status: "failed", category: "translation_contract" };
      }
    }
  } catch {
    return { status: "failed", category: "translation_connection" };
  }
  return delta && completed
    ? { status: "passed" }
    : { status: "failed", category: "translation_contract" };
}

export function readinessStatus(
  probe: "pending" | "passed" | "failed",
  draining: boolean,
) {
  return probe === "passed" && !draining
    ? ({ statusCode: 200, body: { status: "ready" } } as const)
    : ({ statusCode: 503, body: { status: "not_ready" } } as const);
}
