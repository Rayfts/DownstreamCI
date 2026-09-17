import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("config", () => {
  it("parses the versioned config", () => {
    const config = parseConfig(`
version: 1
downstreams:
  - repository: https://github.com/example/project
    ref: main
    ecosystem: npm
    test: npm test
`);
    expect(config.downstreams[0]?.ecosystem).toBe("npm");
  });

  it("rejects an empty downstream set", () => {
    expect(() => parseConfig("version: 1\ndownstreams: []")).toThrow();
  });
});
