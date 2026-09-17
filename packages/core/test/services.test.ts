import { describe, expect, it } from "vitest";
import { normalizeServices } from "../src/sandbox.js";

describe("service configuration", () => {
  it("normalizes image shorthand and keeps structured service policy", () => {
    expect(normalizeServices(["postgres:16", { name: "redis", image: "redis:7", port: 6379 }])).toEqual([
      { name: "postgres", image: "postgres:16" },
      { name: "redis", image: "redis:7", port: 6379 },
    ]);
  });

  it("deduplicates shorthand aliases deterministically", () => {
    expect(normalizeServices(["redis:7", "redis:8"]).map((item) => item.name)).toEqual(["redis", "redis-2"]);
  });
});
