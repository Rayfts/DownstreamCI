import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAdapterForConfig } from "../src/pipeline.js";
import type { DownstreamConfig } from "../src/types.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("pipeline adapter resolution", () => {
  it("detects an npm upstream for auto downstream entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "downstreamci-pipeline-"));
    cleanup.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "example-lib" }));
    const config: DownstreamConfig = {
      version: 1,
      downstreams: [{ repository: "org/project", ref: "abc", ecosystem: "auto", test: "npm test" }],
    };
    expect((await resolveAdapterForConfig(root, config)).id).toBe("npm");
  });

  it("rejects a config that mixes explicit upstream ecosystems", async () => {
    const config: DownstreamConfig = {
      version: 1,
      downstreams: [
        { repository: "org/a", ref: "abc", ecosystem: "npm", test: "npm test" },
        { repository: "org/b", ref: "def", ecosystem: "go", test: "go test ./..." },
      ],
    };
    await expect(resolveAdapterForConfig(".", config)).rejects.toThrow("multiple ecosystem adapters");
  });
});
