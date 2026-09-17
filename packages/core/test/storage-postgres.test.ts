import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresRunStore } from "../src/storage-postgres.js";
import type { Comparison, Execution } from "../src/types.js";

const databaseUrl = process.env.DOWNSTREAMCI_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

function execution(exitCode: number): Execution {
  const test = {
    command: "test",
    exitCode,
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    kind: "test" as const,
  };
  return { test, attempts: [test], environment: { node: "24.0.0" } };
}

integration("PostgreSQL run history", () => {
  it("persists, retrieves, lists, and aggregates distributed run history", async () => {
    if (!databaseUrl) throw new Error("DOWNSTREAMCI_TEST_DATABASE_URL is required for this integration test");
    const store = new PostgresRunStore(databaseUrl);
    const id = `pg-${randomUUID()}`;
    const comparison: Comparison = {
      downstream: { repository: "org/postgres-fixture", ref: "abc123", ecosystem: "npm" },
      classification: "newly-broken",
      confidence: 0.99,
      baseline: execution(0),
      candidate: execution(1),
      candidateSignature: "feedfacefeedface",
      reason: "candidate-only PostgreSQL integration fixture",
    };
    try {
      await store.save(id, "org/upstream", "deadbeef", [comparison]);
      const stored = await store.get(id);
      expect(stored?.[0]?.classification).toBe("newly-broken");
      expect((await store.latest(100)).some((run) => run.id === id)).toBe(true);
      const signals = await store.signals(100);
      expect(signals.downstreams.some((item) => item.repository === "org/postgres-fixture")).toBe(true);
      expect(signals.classifications["newly-broken"]).toBeGreaterThan(0);
    } finally {
      await store.close();
    }
  });
});
