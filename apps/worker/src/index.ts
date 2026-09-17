import { timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { runInDocker } from "@downstreamci/core";
import Fastify from "fastify";
import { runCoordinatorLoop } from "./coordinator.js";

export function createWorkerServer() {
  const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
  app.get("/healthz", async () => ({ ok: true }));

  app.post<{
    Body: {
      image: string;
      workspace: string;
      command: string;
      env?: Record<string, string>;
      network?: "none" | "bridge";
    };
  }>("/v1/execute", async (request, reply) => {
    const configuredToken = process.env.DOWNSTREAMCI_WORKER_TOKEN;
    if (!configuredToken) return reply.code(503).send({ error: "worker execution API is not configured" });
    if (!validBearerToken(request.headers.authorization, configuredToken)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (request.body.network && request.body.network !== "none" && request.body.network !== "bridge") {
      return reply.code(400).send({ error: "network must be none or bridge" });
    }
    const workspace = await confinedWorkspace(request.body.workspace);
    const result = await runInDocker({ ...request.body, workspace });
    if (result.kind === "infrastructure") return reply.code(503).send(result);
    return result;
  });
  return app;
}

export async function confinedWorkspace(requested: string): Promise<string> {
  const configuredRoot = process.env.DOWNSTREAMCI_WORKSPACE_ROOT;
  if (!configuredRoot) throw new Error("DOWNSTREAMCI_WORKSPACE_ROOT must be configured for worker execution");
  const root = await realpath(resolve(configuredRoot));
  const candidate = await realpath(isAbsolute(requested) ? requested : resolve(root, requested));
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return candidate;
  throw new Error("Requested workspace is outside DOWNSTREAMCI_WORKSPACE_ROOT");
}

export function validBearerToken(authorization: string | undefined, expected: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = createWorkerServer();
if (process.env.DOWNSTREAMCI_STANDALONE === "1") {
  await app.listen({ port: Number(process.env.PORT ?? 8790), host: "0.0.0.0" });
  if (process.env.DOWNSTREAMCI_COORDINATOR_URL) {
    const controller = new AbortController();
    process.once("SIGTERM", () => controller.abort());
    process.once("SIGINT", () => controller.abort());
    await runCoordinatorLoop(controller.signal);
  }
}
export { app };
