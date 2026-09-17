import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { runInDocker } from "@downstreamci/core";
import Fastify from "fastify";

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
  const workspace = await confinedWorkspace(request.body.workspace);
  const result = await runInDocker({ ...request.body, workspace });
  if (result.kind === "infrastructure") return reply.code(503).send(result);
  return result;
});

async function confinedWorkspace(requested: string): Promise<string> {
  const configuredRoot = process.env.DOWNSTREAMCI_WORKSPACE_ROOT;
  if (!configuredRoot) throw new Error("DOWNSTREAMCI_WORKSPACE_ROOT must be configured for worker execution");
  const root = await realpath(resolve(configuredRoot));
  const candidate = await realpath(isAbsolute(requested) ? requested : resolve(root, requested));
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return candidate;
  throw new Error("Requested workspace is outside DOWNSTREAMCI_WORKSPACE_ROOT");
}

if (process.env.DOWNSTREAMCI_STANDALONE === "1") {
  await app.listen({ port: Number(process.env.PORT ?? 8790), host: "0.0.0.0" });
}
export { app };
