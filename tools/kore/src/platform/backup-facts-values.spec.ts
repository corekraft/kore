// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import type { BackupFacts, Component, Repository } from "../config/index.js";
import {
  backupFactsHelmArgs,
  backupFactsValueText,
} from "./backup-facts-values.js";

const facts: BackupFacts = {
  targetKind: "interim",
  services: { leads: { hasData: true } },
};

const platformConfig = { name: "kore-platform-config" } as Component;
const other = { name: "kore-platform-backstage" } as Component;

/** A repository carrying the given gate facts, or none. */
function repository(backupFacts?: BackupFacts): Repository {
  return { backupFacts } as unknown as Repository;
}

test("the chart takes the facts as one values document, only for kore-platform-config while they are loaded", () => {
  expect(backupFactsValueText(repository(facts), platformConfig)).toBe(
    JSON.stringify({ backupFacts: facts }),
  );
});

test("no values document is handed to any other component, or while no facts are loaded", () => {
  expect(backupFactsValueText(repository(facts), other)).toBeUndefined();
  expect(backupFactsValueText(repository(), platformConfig)).toBeUndefined();
});

test("the Helm path passes the facts as one --set-json argument to kore-platform-config, and none otherwise", () => {
  expect(backupFactsHelmArgs(repository(facts), platformConfig)).toEqual([
    "--set-json",
    `backupFacts=${JSON.stringify(facts)}`,
  ]);
  expect(backupFactsHelmArgs(repository(facts), other)).toEqual([]);
  expect(backupFactsHelmArgs(repository(), platformConfig)).toEqual([]);
});
