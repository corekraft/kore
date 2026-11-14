import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { liveEnvironment } from "../../src/runtime/index.js";

// Docs: AGENTS.md "Mutations are serialized per environment."
// Real temporary repositories and the real source tree, so this is an integration spec.

afterEach(() => {
  delete process.env.KORE_LIVE_ENVIRONMENT;
  delete process.env.KORE_INTEGRATION_ENVIRONMENT;
  delete process.env.KORE_ROOT;
});

/** A repository root defining the named environments (plus a shared `common`). */
async function repositoryWith(...names: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-live-env-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await writeFile(join(root, "infra/catalog/components.yaml"), "{}");
  await mkdir(join(root, "infra/environments/common"), { recursive: true });
  for (const name of names) {
    await mkdir(join(root, "infra/environments", name), { recursive: true });
    await writeFile(
      join(root, "infra/environments", name, "environment.yaml"),
      "{}",
    );
  }
  process.env.KORE_ROOT = root;
  return root;
}

test("live specs test the local environment unless told otherwise", async () => {
  await repositoryWith("local", "scratch");
  delete process.env.KORE_LIVE_ENVIRONMENT;
  expect(liveEnvironment()).toBe("local");
});

test("an empty KORE_LIVE_ENVIRONMENT counts as unset", async () => {
  await repositoryWith("local", "scratch");
  process.env.KORE_LIVE_ENVIRONMENT = "";
  expect(liveEnvironment()).toBe("local");
});

test("KORE_LIVE_ENVIRONMENT names the environment live specs test", async () => {
  await repositoryWith("local", "scratch");
  process.env.KORE_LIVE_ENVIRONMENT = "scratch";
  expect(liveEnvironment()).toBe("scratch");
});

test("the retired KORE_INTEGRATION_ENVIRONMENT is refused naming KORE_LIVE_ENVIRONMENT, never read as local", async () => {
  await repositoryWith("local", "scratch");
  process.env.KORE_INTEGRATION_ENVIRONMENT = "scratch";
  expect(() => liveEnvironment()).toThrow(
    /KORE_INTEGRATION_ENVIRONMENT is retired; set KORE_LIVE_ENVIRONMENT/,
  );
});

test("an unknown environment is refused naming the variable and the valid environments", async () => {
  await repositoryWith("local", "scratch");
  process.env.KORE_LIVE_ENVIRONMENT = "nope";
  expect(() => liveEnvironment()).toThrow(/KORE_LIVE_ENVIRONMENT/);
  expect(() => liveEnvironment()).toThrow(/local, scratch/);
  expect(() => liveEnvironment()).not.toThrow(/common/);
});

/** A `loadRepository("local"`, an `--environment`, "local"` pair or an `environment: "local"` field. */
function hardcodesLocal(text: string): boolean {
  return [
    /loadRepository\(\s*"local"/,
    /"--environment"\s*,\s*"local"/,
    /environment:\s*"local"\s*[,}]/,
  ].some((pattern) => pattern.test(text));
}

test("hardcodesLocal sees each way code can pin the environment", () => {
  expect(hardcodesLocal('loadRepository("local", root)')).toBe(true);
  expect(hardcodesLocal('["doctor", "--environment", "local"]')).toBe(true);
  expect(hardcodesLocal('{ environment: "local", evidence }')).toBe(true);
  expect(hardcodesLocal('["--environment", environment]')).toBe(false);
  expect(hardcodesLocal('environment: "local" | "managed";')).toBe(false);
});

/** Unit specs and fixtures build their own repositories; everything else may run live. */
function isGuarded(file: string): boolean {
  const unitSpec = file.endsWith(".spec.ts") && !file.endsWith(".live.spec.ts");
  const fixture = /[.-]fixtures\.ts$/.test(file);
  return file.endsWith(".ts") && !unitSpec && !fixture;
}

test("no live or production source file hardcodes the environment it loads or passes", async () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "../../src");
  const files = (await readdir(src, { recursive: true })).filter(isGuarded);
  expect(files.length).toBeGreaterThan(0);
  expect(files).toContain(join("platform", "identity-live.ts"));
  const offenders: string[] = [];
  for (const file of files) {
    if (hardcodesLocal(await readFile(join(src, file), "utf8"))) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
