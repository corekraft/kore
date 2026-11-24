// Fixtures for the platform command specs. A support file is not a unit, so it needs no spec (ADR 0098).
import { vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { contextWith } from "./command-support.js";
import { platformCommands } from "./platform-commands.js";

export const DIGEST = `sha256:${"d".repeat(64)}`;
export const NOW = "2026-11-24T10:00:00.000Z";
export const LOCKS = {
  chartLock: DIGEST,
  imageLock: DIGEST,
  charts: [{ name: "cert-manager", version: "v1.19.1", digest: DIGEST }],
};
export const RECORD_OPTIONS = {
  environment: "vps",
  tag: "v1.4.0",
  "chart-lock": "platform-charts.lock.json",
  "image-lock": "platform-images.lock.json",
};

export function command(name: string): Command {
  const found = platformCommands[name];
  if (found === undefined) {
    throw new Error(`no platform command ${name}`);
  }
  return found;
}

/** A context over fakes: the files by path, the stdin text, and what the commands print. */
export function setup(
  options: Record<string, string | boolean>,
  files: Record<string, string> = {},
  { json = false, stdin = "" } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const readFile = vi.fn((path: string) =>
    path in files
      ? Promise.resolve(files[path] ?? "")
      : Promise.reject(new Error(`ENOENT ${path}`)),
  );
  const context = contextWith(
    {
      fs: { readFile },
      root: () => Promise.resolve("/repo"),
      clock: { now: () => new Date(NOW) },
      stdin: () => Promise.resolve(stdin),
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    },
    options,
    json,
  );
  return {
    context,
    readFile,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

export const CLEAN = { compared: 1, differences: [], notCompared: [] };
export const LOCK_FILES = {
  "/repo/platform-charts.lock.json": "CHART LOCK",
  "/repo/platform-images.lock.json": "IMAGE LOCK",
};

export const EVENT = {
  kind: "platform.rolled-out" as const,
  environment: "vps",
  tag: "v1.4.0",
  charts: "CHARTS",
  occurredAt: NOW,
};
