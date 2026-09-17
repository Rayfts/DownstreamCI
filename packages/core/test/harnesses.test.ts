import { describe, expect, it } from "vitest";
import { getHarness, harnesses } from "../src/harnesses.js";

describe("harness registry", () => {
  it("contains all ten requested harnesses", () => {
    expect(harnesses).toHaveLength(10);
  });

  it("does not fabricate Roo Code headless support", () => {
    expect(getHarness("roo-code").automated).toBe(false);
    expect(getHarness("roo-code").buildInvocation("test")).toBeNull();
  });

  it("uses structured machine output when upstream supports it", () => {
    expect(getHarness("codex").buildInvocation("analyze")?.output).toBe("jsonl");
    expect(getHarness("continue").buildInvocation("analyze")?.output).toBe("json");
  });
});
