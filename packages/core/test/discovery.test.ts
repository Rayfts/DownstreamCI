import { describe, expect, it } from "vitest";
import { rankDiscoveryCandidates } from "../src/discovery.js";

const now = Date.parse("2026-09-17T00:00:00Z");

describe("downstream discovery ranking", () => {
  it("filters archived repositories and favors active adopted projects", () => {
    const ranked = rankDiscoveryCandidates(
      [
        { repository: "org/active", url: "https://github.com/org/active", stars: 5000, forks: 400, archived: false, isFork: false, pushedAt: "2026-09-10T00:00:00Z" },
        { repository: "org/stale", url: "https://github.com/org/stale", stars: 30, forks: 2, archived: false, isFork: false, pushedAt: "2021-01-01T00:00:00Z" },
        { repository: "org/archived", url: "https://github.com/org/archived", stars: 10000, forks: 900, archived: true, isFork: false, pushedAt: "2026-09-16T00:00:00Z" },
      ],
      now,
    );
    expect(ranked.map((item) => item.repository)).toEqual(["org/active", "org/stale"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("penalizes forks without excluding them", () => {
    const [original, fork] = rankDiscoveryCandidates(
      [
        { repository: "org/original", url: "https://github.com/org/original", stars: 100, forks: 10, archived: false, isFork: false, pushedAt: "2026-09-17T00:00:00Z" },
        { repository: "org/fork", url: "https://github.com/org/fork", stars: 100, forks: 10, archived: false, isFork: true, pushedAt: "2026-09-17T00:00:00Z" },
      ],
      now,
    );
    expect(original?.repository).toBe("org/original");
    expect((original?.score ?? 0) - (fork?.score ?? 0)).toBe(10);
  });
});
