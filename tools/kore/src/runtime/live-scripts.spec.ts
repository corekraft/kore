import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const setup = "--import ./dist/src/runtime/live-lock-setup.js";

test("a script runs live specs exactly when it is named test:live", async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  const named = Object.keys(scripts).filter((name) =>
    name.startsWith("test:live"),
  );
  const optedIn = Object.entries(scripts)
    .filter(([, command]) => command.includes("KORE_RUN_LIVE=1"))
    .map(([name]) => name);

  expect(named.length).toBeGreaterThan(0);
  expect(optedIn.sort()).toEqual(named.sort());
});

test("every script that runs live specs holds the environment lock", async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  const live = Object.entries(scripts).filter(([, command]) =>
    command.includes("KORE_RUN_LIVE=1"),
  );

  expect(live.length).toBeGreaterThan(0);
  const missing = live
    .filter(([, command]) => !command.includes(setup))
    .map(([name]) => name);
  expect(
    missing,
    `add \`${setup}\` to node --test in: ${missing.join(", ")}. Live specs mutate the cluster and must hold the environment lock (AGENTS.md: mutations are serialized per environment).`,
  ).toEqual([]);
});
