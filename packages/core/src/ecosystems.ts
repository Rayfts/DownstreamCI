import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CandidateArtifact, Ecosystem } from "./types.js";

export interface EcosystemAdapter {
  id: Ecosystem;
  detect(path: string): Promise<boolean>;
  packageIdentity(path: string): Promise<string>;
  buildCandidate(path: string): Promise<CandidateArtifact>;
  injectionCommands(candidate: CandidateArtifact, mountedCandidatePath?: string): Promise<string[]>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function shell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export const npmAdapter: EcosystemAdapter = {
  id: "npm",
  detect: (path) => exists(join(path, "package.json")),
  async packageIdentity(path) {
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as { name?: string };
    if (!pkg.name) throw new Error("package.json has no name");
    return pkg.name;
  },
  async buildCandidate(path) {
    return {
      ecosystem: "npm",
      identity: await this.packageIdentity(path),
      path,
      metadata: { strategy: "npm-pack-local-tarball" },
    };
  },
  async injectionCommands(_candidate, mountedCandidatePath = "/candidate") {
    return [
      "rm -rf .downstreamci/candidate && mkdir -p .downstreamci/candidate",
      `npm pack ${shell(mountedCandidatePath)} --pack-destination .downstreamci/candidate`,
      "TARBALL=$(ls -t .downstreamci/candidate/*.tgz | head -1) && npm install --no-save --ignore-scripts --no-audit --no-fund \"$TARBALL\"",
    ];
  },
};

export const pythonAdapter: EcosystemAdapter = {
  id: "python",
  async detect(path) {
    return (await exists(join(path, "pyproject.toml"))) || (await exists(join(path, "setup.py")));
  },
  async packageIdentity(path) {
    if (await exists(join(path, "pyproject.toml"))) {
      const text = await readFile(join(path, "pyproject.toml"), "utf8");
      const match = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) return match[1];
    }
    throw new Error("Python package identity could not be determined from pyproject.toml");
  },
  async buildCandidate(path) {
    return {
      ecosystem: "python",
      identity: await this.packageIdentity(path),
      path,
      metadata: { strategy: "wheel-force-reinstall" },
    };
  },
  async injectionCommands(_candidate, mountedCandidatePath = "/candidate") {
    return [
      "rm -rf .downstreamci/candidate-wheel && mkdir -p .downstreamci/candidate-wheel",
      `python -m build --wheel --outdir .downstreamci/candidate-wheel ${shell(mountedCandidatePath)}`,
      "PYTHON=python; if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; fi; \"$PYTHON\" -m pip install --force-reinstall --no-deps .downstreamci/candidate-wheel/*.whl",
    ];
  },
};

export const cargoAdapter: EcosystemAdapter = {
  id: "cargo",
  detect: (path) => exists(join(path, "Cargo.toml")),
  async packageIdentity(path) {
    const text = await readFile(join(path, "Cargo.toml"), "utf8");
    const pkg = text.split("[package]")[1]?.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (!pkg?.[1]) throw new Error("Cargo.toml package name not found");
    return pkg[1];
  },
  async buildCandidate(path) {
    return {
      ecosystem: "cargo",
      identity: await this.packageIdentity(path),
      path,
      metadata: { strategy: "cargo-patch-local-path" },
    };
  },
  async injectionCommands(candidate, mountedCandidatePath = "/candidate") {
    const entry = `\"${candidate.identity.replaceAll('"', '\\"')}\" = { path = \"${mountedCandidatePath.replaceAll('"', '\\"')}\" }`;
    const script = [
      "from pathlib import Path",
      "import re",
      'p = Path("Cargo.toml")',
      "s = p.read_text()",
      'header = "[patch.crates-io]"',
      `entry = ${JSON.stringify(entry)}`,
      `name = ${JSON.stringify(candidate.identity)}`,
      "if header not in s:",
      '    s = s.rstrip() + "\\n\\n" + header + "\\n" + entry + "\\n"',
      "else:",
      "    start = s.index(header) + len(header)",
      "    match = re.search(r'\\n\\[', s[start:])",
      "    end = start + (match.start() if match else len(s) - start)",
      "    section = s[start:end]",
      "    pattern = r'(?m)^\\s*[\"\\\']?' + re.escape(name) + r'[\"\\\']?\\s*=.*$'",
      "    if re.search(pattern, section):",
      "        section = re.sub(pattern, entry, section)",
      "    else:",
      '        section = "\\n" + entry + section',
      "    s = s[:start] + section + s[end:]",
      "p.write_text(s)",
    ].join("\n");
    return [
      `python -c ${shell(script)}`,
      `cargo update -p ${shell(candidate.identity)} --offline`,
    ];
  },
};

export const goAdapter: EcosystemAdapter = {
  id: "go",
  detect: (path) => exists(join(path, "go.mod")),
  async packageIdentity(path) {
    const text = await readFile(join(path, "go.mod"), "utf8");
    const match = text.match(/^module\s+(.+)$/m);
    if (!match?.[1]) throw new Error("go.mod module path not found");
    return match[1].trim();
  },
  async buildCandidate(path) {
    return {
      ecosystem: "go",
      identity: await this.packageIdentity(path),
      path,
      metadata: { strategy: "go-mod-replace" },
    };
  },
  async injectionCommands(candidate, mountedCandidatePath = "/candidate") {
    return [`go mod edit -replace=${shell(candidate.identity)}=${shell(mountedCandidatePath)}`];
  },
};

export const ecosystemAdapters: EcosystemAdapter[] = [npmAdapter, pythonAdapter, cargoAdapter, goAdapter];

export function ecosystemAdapter(id: Ecosystem): EcosystemAdapter {
  const adapter = ecosystemAdapters.find((item) => item.id === id);
  if (!adapter) throw new Error(`Unsupported ecosystem: ${id}`);
  return adapter;
}

export async function detectEcosystem(path: string): Promise<EcosystemAdapter> {
  for (const adapter of ecosystemAdapters) if (await adapter.detect(path)) return adapter;
  throw new Error(`No supported ecosystem detected at ${path}`);
}
