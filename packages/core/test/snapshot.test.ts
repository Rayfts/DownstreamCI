import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createCandidateSnapshot } from "../src/snapshot.js";

const execFile = promisify(execFileCallback);

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}

describe("candidate snapshots", () => {
  it("copies tracked working-tree content without exposing Git metadata, ignored files, or untracked files", async () => {
    const root = await mkdtemp(join(tmpdir(), "downstreamci-snapshot-test-"));
    const repo = join(root, "repo");
    let snapshot: Awaited<ReturnType<typeof createCandidateSnapshot>> | undefined;

    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await execFile("git", ["init", repo]);
      await writeFile(join(repo, ".gitignore"), ".env\nignored/\n", "utf8");
      await writeFile(join(repo, "src", "index.ts"), "export const version = 'staged';\n", "utf8");
      await execFile("git", ["-C", repo, "add", ".gitignore", "src/index.ts"]);

      // Snapshot the current tracked working tree, not only the index/HEAD content.
      await writeFile(join(repo, "src", "index.ts"), "export const version = 'working-tree';\n", "utf8");
      await writeFile(join(repo, ".env"), "LOCAL_SECRET=do-not-copy\n", "utf8");
      await writeFile(join(repo, "notes.txt"), "untracked host note\n", "utf8");
      await mkdir(join(repo, "ignored"), { recursive: true });
      await writeFile(join(repo, "ignored", "token.txt"), "do-not-copy\n", "utf8");

      snapshot = await createCandidateSnapshot(repo);

      expect(await readFile(join(snapshot.path, ".gitignore"), "utf8")).toContain(".env");
      expect(await readFile(join(snapshot.path, "src", "index.ts"), "utf8")).toContain("working-tree");
      await expectMissing(join(snapshot.path, ".git"));
      await expectMissing(join(snapshot.path, ".env"));
      await expectMissing(join(snapshot.path, "notes.txt"));
      await expectMissing(join(snapshot.path, "ignored", "token.txt"));
    } finally {
      await snapshot?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});
