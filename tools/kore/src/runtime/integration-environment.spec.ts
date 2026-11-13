import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { integrationEnvironment } from "./integration-environment.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

afterEach(() => {
  delete process.env.KORE_INTEGRATION_ENVIRONMENT;
});

test("integration specs test the local environment unless told otherwise", () => {
  delete process.env.KORE_INTEGRATION_ENVIRONMENT;
  expect(integrationEnvironment()).toBe("local");
});

test("KORE_INTEGRATION_ENVIRONMENT names the environment integration specs test", () => {
  process.env.KORE_INTEGRATION_ENVIRONMENT = "scratch";
  expect(integrationEnvironment()).toBe("scratch");
});

test("no integration spec hardcodes the environment it loads", async () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");
  const entries = await readdir(src, { recursive: true });
  const specs = entries.filter((entry) =>
    entry.endsWith(".integration.spec.ts"),
  );
  expect(specs.length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const spec of specs) {
    const text = await readFile(join(src, spec), "utf8");
    if (/loadRepository\(\s*"local"/.test(text)) {
      offenders.push(spec);
    }
  }
  expect(offenders).toEqual([]);
});
