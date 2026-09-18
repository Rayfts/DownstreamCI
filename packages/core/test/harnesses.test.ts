import { describe, expect, it } from "vitest";
import { getHarness, harnesses } from "../src/harnesses.js";

describe("coding-agent harness contracts", () => {
  it("registers exactly the ten researched harnesses with provenance", () => {
    expect(harnesses).toHaveLength(10);
    expect(new Set(harnesses.map((item) => item.id)).size).toBe(10);
    for (const harness of harnesses) {
      expect(harness.verifiedAt).toBe("2026-09-17");
      expect(harness.evidence.length).toBeGreaterThan(0);
      expect(harness.upstream).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    }
    expect(getHarness("pi").upstream).toBe("mitsuhiko/pi-mono");
  });

  it("uses canonical machine-friendly invocations without fabricating Roo headless support", () => {
    const prompt = "evidence prompt";
    expect(getHarness("codex").buildInvocation(prompt)).toEqual({
      command: "codex",
      args: ["exec", "--json", prompt],
      output: "jsonl",
    });
    expect(getHarness("pi").buildInvocation(prompt)?.args).toEqual(["--mode", "json", "-p", prompt]);
    expect(getHarness("gemini").buildInvocation(prompt)?.args).toEqual(["-p", prompt, "--output-format", "stream-json"]);
    expect(getHarness("goose").buildInvocation(prompt)).toEqual({
      command: "goose",
      args: ["run", "--output-format", "stream-json", "--no-session", "--text", prompt],
      output: "jsonl",
    });
    expect(getHarness("goose").structuredOutput).toBe(true);
    expect(getHarness("cline").buildInvocation(prompt)?.args).toContain("false");
    expect(getHarness("continue").buildInvocation(prompt)?.args).toEqual(["-p", prompt, "--format", "json"]);
    expect(getHarness("roo-code").automated).toBe(false);
    expect(getHarness("roo-code").buildInvocation(prompt)).toBeNull();
  });

  it("passes the analysis prompt exactly once to each automated invocation", () => {
    const prompt = "unique-analysis-prompt";
    for (const harness of harnesses.filter((item) => item.automated)) {
      const invocation = harness.buildInvocation(prompt);
      expect(invocation).not.toBeNull();
      expect(invocation?.args.filter((value) => value === prompt)).toHaveLength(1);
    }
  });
});
