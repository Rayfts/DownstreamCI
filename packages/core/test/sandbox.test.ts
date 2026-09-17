import { describe, expect, it } from "vitest";
import { boundedResources, normalizeServices } from "../src/sandbox.js";

describe("sandbox policy bounds", () => {
  it("clamps programmatic resource requests even when config validation is bypassed", () => {
    expect(
      boundedResources({ cpus: 999, memoryMb: 999999, pids: 999999, timeoutSeconds: 999999 }),
    ).toEqual({ cpus: 16, memoryMb: 32768, pids: 4096, timeoutSeconds: 7200 });
  });

  it("uses safe defaults for invalid programmatic numbers", () => {
    expect(boundedResources({ cpus: Number.NaN, memoryMb: Number.POSITIVE_INFINITY })).toEqual({
      cpus: 2,
      memoryMb: 2048,
      pids: 256,
      timeoutSeconds: 900,
    });
  });

  it("rejects service tmpfs values that can smuggle Docker mount options", () => {
    expect(() => normalizeServices([{ name: "db", image: "postgres:16", tmpfs: ["/data:exec"] }])).toThrow(
      "Invalid service tmpfs target",
    );
  });
});
