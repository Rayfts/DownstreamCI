import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const actionPath = new URL("../../../action.yml", import.meta.url);

describe("GitHub Action metadata", () => {
  it("defines a composite action with explicit credentials and trusted policy selection", async () => {
    const source = await readFile(actionPath, "utf8");
    const parsed = YAML.parse(source) as {
      inputs?: Record<string, { default?: string }>;
      runs?: { using?: string; steps?: Array<{ run?: string }> };
    };
    expect(parsed.runs?.using).toBe("composite");
    expect(parsed.inputs?.["github-token"]?.default).toBe("");
    expect(parsed.inputs?.["policy-ref"]?.default).toBe("");
    expect(parsed.inputs?.["build-runner"]?.default).toBe("true");
    expect(parsed.runs?.steps?.some((step) => step.run?.includes("apps/cli/dist/index.js"))).toBe(true);
    expect(source).toContain("github.event.pull_request.base.sha");
    expect(source).toContain("git -C \"$GITHUB_WORKSPACE\" show");
    expect(source).toContain("pull_request_target");
  });
});
