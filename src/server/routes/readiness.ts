import type { FastifyInstance } from "fastify";

import { readinessStatus } from "../adapters/startup-contract.js";

export function registerReadinessRoute(
  app: FastifyInstance,
  state: {
    probe: "pending" | "passed" | "failed";
    draining: boolean;
  },
) {
  app.get("/health/ready", async (_request, reply) => {
    const result = readinessStatus(state.probe, state.draining);
    return reply.code(result.statusCode).send(result.body);
  });
}
