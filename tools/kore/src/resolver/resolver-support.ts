// Fakes shared by the resolver domain's unit specs. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Environment } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ResolverHost, ResolverTarget } from "./resolver.js";

export const environment = { name: "local" } as unknown as Environment;

export const target: ResolverTarget = {
  path: "/etc/resolver/kore.internal",
  zone: "kore.internal",
  nameserver: "127.0.0.1",
  port: 1053,
  content: "# Managed by kore dns install\nnameserver 127.0.0.1\nport 1053\n",
};

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

export function fakeRunner() {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout: "",
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/** Reads `file`, or fails with it when it is an error; probes answer `answer`, or fail with it. */
export function fakeHost(
  file: string | undefined | Error,
  answer: string[] | Error = ["127.0.0.1"],
): ResolverHost & {
  read: ReturnType<typeof vi.fn>;
  probe: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async () => {
      if (file instanceof Error) {
        throw file;
      }
      return file;
    }),
    probe: vi.fn(async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    }),
  };
}
