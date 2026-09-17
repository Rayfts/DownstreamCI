import { describe, expect, it } from "vitest";
import { CoordinatorJobStore } from "../src/jobs.js";

describe("CoordinatorJobStore", () => {
  it("durably queues trusted base metadata, renews leases, and ownership-checks completion", () => {
    const store = new CoordinatorJobStore(":memory:");
    try {
      store.enqueue({
        id: "job-1",
        owner: "org",
        repo: "project",
        headRepository: "contributor/project",
        headSha: "abc",
        baseSha: "def",
        pullNumber: 7,
        installationId: 11,
        checkRunId: 13,
      });
      const claimed = store.claim("worker-a", 120);
      expect(claimed?.id).toBe("job-1");
      expect(claimed?.headRepository).toBe("contributor/project");
      expect(claimed?.baseSha).toBe("def");
      expect(claimed?.status).toBe("running");
      expect(claimed?.workerId).toBe("worker-a");
      expect(store.claim("worker-b", 120)).toBeNull();

      const originalLease = claimed?.leaseUntil ?? 0;
      expect(store.renew("job-1", "worker-b", 240)).toBeNull();
      const renewed = store.renew("job-1", "worker-a", 240);
      expect(renewed?.leaseUntil).toBeGreaterThan(originalLease);

      expect(store.finishClaimed("job-1", "worker-b", "completed")).toBeNull();
      expect(store.finishClaimed("job-1", "worker-a", "completed")?.status).toBe("completed");
    } finally {
      store.close();
    }
  });
});
