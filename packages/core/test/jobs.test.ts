import { describe, expect, it } from "vitest";
import { CoordinatorJobStore } from "../src/jobs.js";

describe("CoordinatorJobStore", () => {
  it("durably queues, leases, and completes jobs", () => {
    const store = new CoordinatorJobStore(":memory:");
    try {
      store.enqueue({
        id: "job-1",
        owner: "org",
        repo: "project",
        headSha: "abc",
        pullNumber: 7,
        installationId: 11,
        checkRunId: 13,
      });
      const claimed = store.claim("worker-a", 120);
      expect(claimed?.id).toBe("job-1");
      expect(claimed?.status).toBe("running");
      expect(claimed?.workerId).toBe("worker-a");
      expect(store.claim("worker-b", 120)).toBeNull();
      expect(store.finish("job-1", "completed")?.status).toBe("completed");
    } finally {
      store.close();
    }
  });
});
