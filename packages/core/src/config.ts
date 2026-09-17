import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import type { DownstreamConfig } from "./types.js";

const resourceSchema = z.object({
  cpus: z.number().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  pids: z.number().int().positive().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
});

const serviceSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  image: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  command: z.array(z.string()).optional(),
  tmpfs: z.array(z.string().min(1)).optional(),
  healthcheck: z.string().min(1).optional(),
  healthTimeoutSeconds: z.number().int().positive().max(300).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  memoryMb: z.number().int().positive().optional(),
  pids: z.number().int().positive().optional(),
  readOnly: z.boolean().optional(),
});

const downstreamSchema = z.object({
  repository: z.string().min(1),
  ref: z.string().min(1).default("main"),
  ecosystem: z.enum(["auto", "npm", "python", "cargo", "go"]).default("auto"),
  setup: z.string().optional(),
  build: z.string().optional(),
  test: z.string().min(1),
  timeoutSeconds: z.number().int().positive().optional(),
  runtime: z.record(z.string(), z.string()).optional(),
  replacement: z.string().optional(),
  services: z.array(z.union([z.string().min(1), serviceSchema])).optional(),
  resources: resourceSchema.optional(),
  network: z.object({ mode: z.enum(["none", "bridge"]).default("none") }).optional(),
  env: z.record(z.string(), z.string()).optional(),
  tags: z.array(z.string()).optional(),
  expectedFlakyTests: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

const configSchema = z.object({
  version: z.literal(1),
  downstreams: z.array(downstreamSchema).min(1),
});

export async function loadConfig(path: string): Promise<DownstreamConfig> {
  const raw = await readFile(path, "utf8");
  return parseConfig(raw);
}

export function parseConfig(raw: string): DownstreamConfig {
  return configSchema.parse(YAML.parse(raw) as unknown) as DownstreamConfig;
}
