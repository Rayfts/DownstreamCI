import { createHash } from "node:crypto";
import { failureSignature, normalizeFailure } from "./signatures.js";
import type { Comparison, FailureCluster } from "./types.js";

export function clusterComparisons(comparisons: Comparison[]): Comparison[] {
  const groups = new Map<string, { cluster: FailureCluster; indexes: number[] }>();

  comparisons.forEach((comparison, index) => {
    if (comparison.classification !== "newly-broken") return;
    const log = `${comparison.candidate.test.stderr}\n${comparison.candidate.test.stdout}`;
    const fingerprint = comparison.candidateSignature ?? failureSignature(log);
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.indexes.push(index);
      existing.cluster.members += 1;
      return;
    }
    groups.set(fingerprint, {
      cluster: {
        id: `cluster-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`,
        fingerprint,
        label: failureLabel(log),
        members: 1,
      },
      indexes: [index],
    });
  });

  const result = comparisons.map((comparison) => ({ ...comparison }));
  for (const { cluster, indexes } of groups.values()) {
    for (const index of indexes) {
      const comparison = result[index];
      if (comparison) result[index] = { ...comparison, cluster: { ...cluster } };
    }
  }
  return result;
}

function failureLabel(log: string): string {
  const lines = normalizeFailure(log).split("\n").filter(Boolean);
  const signal = [...lines]
    .reverse()
    .find((line) => /(?:error|exception|panic|failed|failure|cannot|undefined|mismatch|assert)/i.test(line));
  return (signal ?? lines.at(-1) ?? "candidate failure").slice(0, 180);
}
