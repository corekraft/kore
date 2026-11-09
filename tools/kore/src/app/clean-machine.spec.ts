import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  assertThrowawayProfile,
  cleanMachineProfile,
  stageThrowawayCheckout,
  throwawayEnvironment,
} from "./clean-machine.js";

// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
// The clean-machine end-to-end test creates and destroys a Minikube profile.
// It must be a profile of its own, never the developer's kore-local, and it
// must run from a staged checkout so it cannot touch the real .kore/ state.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-clean-machine-spec-"));
  roots.push(root);
  return root;
}

const environment = JSON.stringify({
  name: "local",
  provider: "minikube",
  kubeContext: "kore-local",
  cluster: { profile: "kore-local", cpus: 4 },
});

test("the throwaway profile is never kore-local or another environment's profile", () => {
  expect(() => assertThrowawayProfile(cleanMachineProfile)).not.toThrow();
  expect(() => assertThrowawayProfile("kore-local")).toThrow(
    /never the developer profile/,
  );
  expect(() => assertThrowawayProfile("minikube")).toThrow(
    /never the developer profile/,
  );
  expect(() => assertThrowawayProfile("")).toThrow(/never the developer/);
});

test("the staged environment moves the cluster and context to the throwaway profile and changes nothing else", () => {
  const staged = JSON.parse(
    throwawayEnvironment(environment, cleanMachineProfile),
  ) as {
    kubeContext: string;
    name: string;
    cluster: { profile: string; cpus: number };
  };
  expect(staged.kubeContext).toBe(cleanMachineProfile);
  expect(staged.cluster).toEqual({ profile: cleanMachineProfile, cpus: 4 });
  expect(staged.name).toBe("local");
});

test("staging copies only tracked files, rewrites the environment, and leaves the source untouched", async () => {
  const source = await temp();
  const destination = join(await temp(), "checkout");
  await mkdir(join(source, "infra/environments/local"), { recursive: true });
  const envPath = "infra/environments/local/environment.yaml";
  await writeFile(join(source, envPath), environment);
  await writeFile(join(source, "README.md"), "readme");
  await mkdir(join(source, ".kore/state"), { recursive: true });
  await writeFile(join(source, ".kore/state/secret"), "never copied");
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      return {
        stdout: `${envPath}\0README.md\0`,
        stderr: "",
        code: 0,
      };
    },
  };

  await stageThrowawayCheckout(
    source,
    destination,
    cleanMachineProfile,
    runner,
  );

  expect(calls).toEqual([["git", "-C", source, "ls-files", "-z"]]);
  expect(await readFile(join(destination, "README.md"), "utf8")).toBe("readme");
  expect(
    JSON.parse(await readFile(join(destination, envPath), "utf8")).cluster
      .profile,
  ).toBe(cleanMachineProfile);
  await expect(stat(join(destination, ".kore"))).rejects.toThrow();
  expect(await readFile(join(source, envPath), "utf8")).toBe(environment);
});

test("staging refuses a non-throwaway profile before touching anything", async () => {
  const runner: Runner = {
    async run() {
      throw new Error("no command may run");
    },
  };
  await expect(
    stageThrowawayCheckout("/src", "/dst", "kore-local", runner),
  ).rejects.toThrow(/never the developer profile/);
});
