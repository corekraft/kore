import { expect, test } from "vitest";
import {
  loadRepository,
  type BackupFacts,
  type Repository,
} from "../../src/config/index.js";
import { render } from "./gateway-service-support.js";

// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The ConfigMap the external Gateway check reads (ADR 0155): the backup target's kind and each service's
// has-data fact. It renders only while database-backups is on, and its content follows the facts kore hands in.

const facts: BackupFacts = {
  targetKind: "interim",
  services: { leads: { hasData: true }, shop: { hasData: false } },
};

/** The vps repository with database-backups set as given, and the facts the overlay yields, when any. */
async function vps(
  on: boolean,
  backupFacts?: BackupFacts,
): Promise<Repository> {
  const repository = await loadRepository("vps");
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, "database-backups": on },
    },
    backupFacts,
  };
}

/** The ConfigMap document of a render, without its Helm source comment; undefined when the render has none. */
function factsMap(output: string): string | undefined {
  return output
    .split(/^---$/m)
    .filter(
      (document) =>
        /^kind: ConfigMap$/m.test(document) &&
        /^  name: kore-backup-facts$/m.test(document),
    )
    .map((document) =>
      document
        .split("\n")
        .filter((line) => !line.startsWith("# Source:"))
        .join("\n")
        .trim(),
    )[0];
}

test("with database-backups on, vps renders the facts ConfigMap in kore-system, with the target kind and each service's has-data fact", async () => {
  expect(factsMap(render(await vps(true, facts)))).toBe(
    `apiVersion: v1
kind: ConfigMap
metadata:
  name: kore-backup-facts
  namespace: kore-system
  labels: {app.kubernetes.io/managed-by: Helm}
data:
  targetKind: "interim"
  services.json: "{\\"leads\\":{\\"hasData\\":true},\\"shop\\":{\\"hasData\\":false}}"`,
  );
});

test("the ConfigMap follows the overlay: an off-host kind is published as off-host", async () => {
  const output = render(await vps(true, { ...facts, targetKind: "off-host" }));
  expect(factsMap(output)).toContain('targetKind: "off-host"');
});

test("with database-backups off nothing of the facts ConfigMap renders, whatever facts are handed in", async () => {
  expect(factsMap(render(await vps(false, facts)))).toBeUndefined();
  expect(factsMap(render(await vps(false)))).toBeUndefined();
});

test("with database-backups on and no facts handed in, the render refuses, naming the field and the fix", async () => {
  const repository = await vps(true);
  expect(() => render(repository)).toThrow(
    /backupFacts must be handed in by kore while database-backups is on: declare backup\.target in the environment overlay, or turn database-backups off/,
  );
});
