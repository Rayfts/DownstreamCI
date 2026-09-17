import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const actionPath = new URL("../../../action.yml", import.meta.url);

describe("GitHub Action metadata", () => {
  it("defines a composite action with explicit credential input", async () => {
    const parsed = YAML.parse(await readFile(actionPath, "utf8")) as {
      inputs?: Record<string, { default?: string }>;
      runs?: { using?: string; steps?: Array<{ run?: string }> };
    };
    expect(parsed.runs?.using).toBe("composite");
    expect(parsed.inputs?.["github-token"]?.default).toBe("");
    expect(parsed.inputs?.["build-runner"]?.default).toBe("true");
    expect(parsed.runs?.steps?.some((step) => step.run?.includes("apps/cli/dist/index.js"))).toBe(true);
  });
});
