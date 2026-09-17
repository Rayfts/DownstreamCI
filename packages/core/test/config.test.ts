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

  it("rejects resource requests above worker safety maxima", () => {
    expect(() =>
      parseConfig(`
version: 1
downstreams:
  - repository: org/project
    ecosystem: npm
    test: npm test
    resources:
      cpus: 128
      memoryMb: 999999
      pids: 999999
      timeoutSeconds: 999999
`),
    ).toThrow();
  });

  it("rejects unsafe service tmpfs options and excessive sidecars", () => {
    expect(() =>
      parseConfig(`
version: 1
downstreams:
  - repository: org/project
    ecosystem: npm
    test: npm test
    services:
      - name: db
        image: postgres:16
        tmpfs: ["/data:exec"]
`),
    ).toThrow();
  });
});
