import { describe, expect, it } from "vitest";
import { cargoAdapter, goAdapter, npmAdapter, pythonAdapter } from "../src/ecosystems.js";

const candidate = (ecosystem: "npm" | "python" | "cargo" | "go", identity: string) => ({
  ecosystem,
  identity,
  path: "/source",
  metadata: { strategy: "test" },
});

describe("ecosystem manager strategies", () => {
  it("uses npm, pnpm, or yarn based on downstream metadata and lockfiles", async () => {
    const setup = (await npmAdapter.setupCommands()).join("\n");
    const inject = (await npmAdapter.injectionCommands(candidate("npm", "example"))).join("\n");
    expect(setup).toContain("pnpm install --frozen-lockfile");
    expect(setup).toContain("yarn install --immutable");
    expect(setup).toContain("npm ci");
    expect(inject).toContain("pnpm add --ignore-scripts");
    expect(inject).toContain("YARN_ENABLE_SCRIPTS=false");
    expect(inject).toContain("npm install --no-save --ignore-scripts");
  });

  it("uses uv, Poetry, or pip for Python downstreams", async () => {
    const setup = (await pythonAdapter.setupCommands()).join("\n");
    const inject = (await pythonAdapter.injectionCommands(candidate("python", "example"))).join("\n");
    expect(setup).toContain("uv sync --frozen");
    expect(setup).toContain("poetry install --no-interaction");
    expect(setup).toContain("pip install -r requirements.txt");
    expect(inject).toContain("uv pip install");
    expect(inject).toContain("poetry run python -m pip install");
  });

  it("pre-fetches Cargo dependencies and injects a crates.io patch", async () => {
    expect((await cargoAdapter.setupCommands()).join(" ")).toContain("cargo fetch");
    expect((await cargoAdapter.injectionCommands(candidate("cargo", "sample-crate"))).join(" ")).toContain(
      "[patch.crates-io]",
    );
  });

  it("downloads Go modules and uses a local replace directive", async () => {
    expect(await goAdapter.setupCommands()).toEqual(["go mod download"]);
    expect((await goAdapter.injectionCommands(candidate("go", "example.com/upstream"))).join(" ")).toContain(
      "go mod edit -replace=",
    );
  });
});
