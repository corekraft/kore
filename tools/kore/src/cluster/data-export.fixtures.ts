import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { Repository } from "../config/index.js";
import { k3dRepository, list } from "./k3d-cluster.fixtures.js";
import {
  CommandError,
  type RunOptions,
  type RunResult,
  type Runner,
} from "../runtime/index.js";

export const RECIPIENT =
  "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
export const PLAINTEXT =
  "CREATE TABLE tokens (v text);\nCOPY tokens FROM stdin; -- PLAINTEXT-MARKER\n";
export const CIPHERTEXT =
  "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3YxCg==\n-----END AGE ENCRYPTED FILE-----\n";
export const NOW = new Date("2026-11-08T12:00:00.000Z");

interface Call {
  command: string;
  args: readonly string[];
  options?: RunOptions;
}

export class FakeRunner implements Runner {
  calls: Call[] = [];
  uncovered = "";
  tableCount = "0";
  failAge = false;
  clusters = "pg-main pg-main-1\n";
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    const joined = args.join(" ");
    if (command === "k3d") {
      return ok(list(1));
    }
    if (command === "age") {
      if (this.failAge) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "age: boom",
          code: 1,
        });
      }
      return ok(args.includes("--decrypt") ? PLAINTEXT : CIPHERTEXT);
    }
    if (joined.includes("jsonpath={.metadata.name}")) {
      return ok("kube-system");
    }
    if (joined.includes("get cluster.postgresql.cnpg.io")) {
      return ok(this.clusters);
    }
    if (joined.includes("get pvc")) {
      return ok(this.uncovered);
    }
    if (joined.includes("pg_dump")) {
      return ok(PLAINTEXT);
    }
    if (joined.includes("information_schema")) {
      return ok(this.tableCount);
    }
    return ok("");
  }
}

export const exportOptions = { namespace: "reference", now: () => NOW };

/** A repository rooted in a temporary directory whose .sops.yaml names a valid recipient. */
export function useExportRepository(): {
  repository: Repository;
  root: string;
} {
  const state = {} as { repository: Repository; root: string };
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "kore-export-"));
    await writeFile(
      join(state.root, ".sops.yaml"),
      `creation_rules:\n  - path_regex: infra/environments/local/secrets/.*\\.enc\\.yaml$\n    encrypted_regex: '^(data|stringData)$'\n    age: ${RECIPIENT}\n`,
    );
    state.repository = {
      ...(await k3dRepository()),
      root: state.root,
    };
  });
  afterEach(async () => {
    await rm(state.root, { recursive: true, force: true });
  });
  return state;
}
