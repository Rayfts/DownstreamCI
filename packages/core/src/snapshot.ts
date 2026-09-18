import type { Stats } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runProcess } from "./process.js";

export interface CandidateSnapshot {
  path: string;
  cleanup(): Promise<void>;
}

export async function createCandidateSnapshot(source: string): Promise<CandidateSnapshot> {
  const sourceRoot = resolve(source);
  const root = await mkdtemp(join(tmpdir(), "downstreamci-candidate-"));
  const targetRoot = join(root, "source");
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });

  try {
    const listing = await runProcess("git", ["-C", sourceRoot, "ls-files", "-z", "--cached"], {
      timeoutSeconds: 60,
      maxOutputBytes: 32 * 1024 * 1024,
      kind: "setup",
    });
    if (listing.exitCode !== 0) {
      throw new Error(
        `Candidate source must be a Git working tree so DownstreamCI can exclude untracked/ignored host files: ${listing.stderr || listing.stdout}`,
      );
    }

    const files = listing.stdout.split("\0").filter(Boolean);
    for (const relativePath of files) {
      assertTrackedPath(relativePath);
      const sourcePath = join(sourceRoot, relativePath);
      const targetPath = join(targetRoot, relativePath);
      let stat: Stats;
      try {
        stat = await lstat(sourcePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stat.isDirectory()) {
        // Gitlink/submodule entries are intentionally not recursively copied because
        // their working trees can contain untracked or ignored host files.
        continue;
      }
      await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
      if (stat.isSymbolicLink()) {
        await symlink(await readlink(sourcePath), targetPath);
      } else if (stat.isFile()) {
        await copyFile(sourcePath, targetPath);
        await chmod(targetPath, stat.mode & 0o777);
      }
    }

    return {
      path: targetRoot,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function assertTrackedPath(relativePath: string): void {
  const segments = relativePath.split(/[\\/]/u);
  if (
    relativePath.length === 0 ||
    segments.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(relativePath) ||
    relativePath.includes("\0")
  ) {
    throw new Error(`Unsafe tracked candidate path: ${relativePath}`);
  }
}
