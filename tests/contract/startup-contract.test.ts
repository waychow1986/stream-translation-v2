import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type StartupModule = {
  runStartupContractProbe(port: {
    stream(request: unknown): AsyncIterable<unknown>;
  }): Promise<{ status: "passed" | "failed"; category?: string }>;
  readinessStatus(
    probe: "pending" | "passed" | "failed",
    draining: boolean,
  ): { statusCode: 200 | 503; body: { status: "ready" | "not_ready" } };
};

const moduleUrl = new URL(
  "../../src/server/adapters/startup-contract.js",
  import.meta.url,
);
const runPending =
  process.env["AIDELIVERY_RUN_PENDING_TESTS"] === "1" ||
  existsSync(fileURLToPath(moduleUrl));

async function* stream(...values: unknown[]) {
  yield* values;
}

describe.runIf(runPending)("startup Foundry contract probe", () => {
  async function load(): Promise<StartupModule> {
    return (await import(moduleUrl.href)) as StartupModule;
  }

  it("passes only a non-empty delta followed by completion", async () => {
    const { runStartupContractProbe } = await load();
    const result = await runStartupContractProbe({
      stream: () =>
        stream(
          { type: "response.output_text.delta", delta: "已" },
          { type: "response.completed" },
        ),
    });
    expect(result).toEqual({ status: "passed" });
  });

  it.each([
    ["empty", [{ type: "response.completed" }]],
    ["error", [{ type: "error", error: { code: "bad_request" } }]],
    ["unknown", [{ type: "provider.unknown" }]],
    ["malformed delta", [{ type: "response.output_text.delta", delta: "" }]],
  ])("rejects %s streams", async (_name, providerEvents) => {
    const { runStartupContractProbe } = await load();
    await expect(
      runStartupContractProbe({
        stream: () => stream(...providerEvents),
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("reports not ready for pending, failed or draining states", async () => {
    const { readinessStatus } = await load();
    expect(readinessStatus("pending", false).statusCode).toBe(503);
    expect(readinessStatus("failed", false).statusCode).toBe(503);
    expect(readinessStatus("passed", true).statusCode).toBe(503);
    expect(readinessStatus("passed", false)).toEqual({
      statusCode: 200,
      body: { status: "ready" },
    });
  });
});
