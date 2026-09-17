import { createHash } from "node:crypto";

const noise = [
  /\b\d+(?:\.\d+)?ms\b/g,
  /\b\d+(?:\.\d+)?s\b/g,
  /\/tmp\/[^\s:]+/g,
  /[A-Za-z]:\\[^\s:]+/g,
  /\b0x[0-9a-f]+\b/gi,
  /\b\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?\b/g,
];

export function normalizeFailure(text: string): string {
  let normalized = text.replaceAll("\r\n", "\n");
  for (const rule of noise) normalized = normalized.replace(rule, "<volatile>");
  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-120)
    .join("\n");
}

export function failureSignature(text: string): string {
  return createHash("sha256").update(normalizeFailure(text)).digest("hex").slice(0, 16);
}
