import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  timeoutSeconds?: number;
  input?: string;
  kind?: CommandResult["kind"];
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function runProcess(command: string, args: string[], options: RunProcessOptions = {}): Promise<CommandResult> {
  const started = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const inherited = options.inheritEnv === false ? {} : process.env;
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...inherited, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = options.timeoutSeconds
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutSeconds * 1000)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendTail(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendTail(stderr, chunk, maxOutputBytes);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command: [command, ...args].join(" "),
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        ...(options.kind ? { kind: options.kind } : {}),
      });
    });
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

function appendTail(existing: string, chunk: string, maxBytes: number): string {
  const combined = existing + chunk;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
  const bytes = Buffer.from(combined, "utf8");
  return `[output truncated to last ${maxBytes} bytes]\n${bytes.subarray(bytes.length - maxBytes).toString("utf8")}`;
}
