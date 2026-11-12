import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner, RunOptions } from "../runtime/index.js";
import {
  ensureRegistryTrust,
  loadRegistryCa,
  registryTrustProblem,
} from "./registry-tls.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

const home = mkdtempSync(join(tmpdir(), "kore-registry-tls-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const pem = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const b64 = (value: string) => Buffer.from(value).toString("base64");

function runnerWith(options: { ca?: string; fail?: string } = {}) {
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  const runner: Runner = {
    async run(command, args, runOptions) {
      calls.push({
        command,
        args,
        ...(runOptions ? { options: runOptions } : {}),
      });
      if (command === "kubectl" && args.includes("oci-registry-tls")) {
        return {
          stdout:
            options.ca === undefined
              ? ""
              : JSON.stringify({ data: { "ca.crt": b64(options.ca) } }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("a missing CA fails closed with the command that issues it", async () => {
  const repository = await loadRepository("local");
  const { runner } = runnerWith();
  await expect(loadRegistryCa(repository, runner)).rejects.toThrow(
    /oci-registry-tls.*kore platform up --env local/s,
  );
});

test("a Secret that holds no PEM certificate is rejected, not trusted", async () => {
  const repository = await loadRepository("local");
  const { runner } = runnerWith({ ca: "garbage" });
  await expect(loadRegistryCa(repository, runner)).rejects.toThrow(
    /not a PEM certificate/,
  );
});

test("trust distribution publishes only the public CA: a ConfigMap for Policy Controller, with no node shell", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = runnerWith({ ca: pem });
  await ensureRegistryTrust(repository, runner, home);

  const apply = calls.find((c) => c.args.includes("apply"))!;
  const items = (
    JSON.parse(apply.options?.input ?? "{}") as {
      items: {
        kind: string;
        metadata: { name: string; namespace: string };
        data?: Record<string, string>;
      }[];
    }
  ).items;
  const map = items.find((i) => i.kind === "ConfigMap")!;
  expect(map.metadata).toMatchObject({
    name: "kore-registry-ca",
    namespace: "cosign-system",
  });
  expect(map.data).toEqual({ "ca.crt": pem });
  expect(JSON.stringify(items)).not.toMatch(/PRIVATE KEY|tls\.key/);

  const commands = calls.map((c) => c.command);
  expect(commands).not.toContain("ssh");
  expect(calls.some((c) => c.args.includes("exec"))).toBe(false);
});

test("the CA reaches the nodes through the host trust directory, never a node command", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = runnerWith({ ca: pem });
  await ensureRegistryTrust(repository, runner, home);
  const written = await readFile(
    join(home, ".kore", "k3d", "kore-local", "registry-trust", "ca.crt"),
    "utf8",
  );
  expect(written).toBe(pem);
  expect(calls.map((c) => c.command)).not.toContain("ssh");
});

test("trust is reapplied identically on a second run so nothing is reissued", async () => {
  const repository = await loadRepository("local");
  const first = runnerWith({ ca: pem });
  const second = runnerWith({ ca: pem });
  await ensureRegistryTrust(repository, first.runner, home);
  await ensureRegistryTrust(repository, second.runner, home);
  expect(second.calls.map((c) => c.args)).toEqual(
    first.calls.map((c) => c.args),
  );
  // Nothing in trust distribution creates or deletes a certificate resource.
  expect(JSON.stringify(first.calls)).not.toMatch(
    /delete|certificate\.cert-manager/,
  );
});

test("an external registry is the provider's to trust: kore distributes nothing", async () => {
  const repository = await loadRepository("managed-example");
  const { runner, calls } = runnerWith({ ca: pem });
  await ensureRegistryTrust(repository, runner, home);
  expect(calls).toEqual([]);
});

test("status reports a missing CA with the fix, and nothing when it is present", async () => {
  const repository = await loadRepository("local");
  expect(await registryTrustProblem(repository, runnerWith().runner)).toMatch(
    /kore platform up --env local/,
  );
  const present = runnerWith({ ca: pem });
  expect(
    await registryTrustProblem(repository, present.runner),
  ).toBeUndefined();
});
