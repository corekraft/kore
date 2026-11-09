import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { enrollPlatformNamespaces } from "./enrollment.js";

// Docs: docs/decisions/0056-platform-image-inventory.md
// Enforce environments label catalog namespaces; audit ones never do.

interface Existing {
  name: string;
  labelled?: boolean;
  ownedByKore?: boolean;
}

interface Call {
  args: string[];
  input: string;
}

function cluster(existing: Existing[]) {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      assert.equal(command, "kubectl");
      calls.push({ args: [...args], input: options?.input ?? "" });
      if (args.includes("get")) {
        return {
          stdout: JSON.stringify({
            items: existing.map((ns) => ({
              metadata: {
                name: ns.name,
                labels: ns.labelled
                  ? { "policy.sigstore.dev/include": "true" }
                  : {},
                managedFields: ns.ownedByKore
                  ? [{ manager: "kore-enrollment" }]
                  : [{ manager: "helm" }],
              },
            })),
          }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

const applies = (calls: Call[]) =>
  calls.filter(({ args }) => args.includes("apply"));

const appliedName = ({ input }: Call) => /name: (\S+)/.exec(input)![1]!;

function namespaces(repository: Repository): string[] {
  return [...new Set(repository.catalog.components.map((c) => c.namespace))];
}

async function enforce() {
  return await loadRepository("managed-example");
}

test("enforce labels every platform namespace except the exemptions, with the configured context and field manager", async () => {
  const repository = await enforce();
  const exempt = Object.keys(repository.environment.enrollmentExemptions!);
  const { runner, calls } = cluster(
    namespaces(repository).map((name) => ({ name })),
  );

  await enrollPlatformNamespaces(repository, runner);

  const applied = applies(calls);
  assert.deepEqual(
    applied.map(appliedName).sort(),
    namespaces(repository)
      .filter((n) => !exempt.includes(n))
      .sort(),
  );
  for (const call of applied) {
    assert.deepEqual(call.args.slice(0, 2), [
      "--context",
      repository.environment.kubeContext,
    ]);
    assert.ok(call.args.includes("--server-side"));
    assert.ok(call.args.includes("--field-manager=kore-enrollment"));
    assert.match(call.input, /policy\.sigstore\.dev\/include: "true"/);
  }
});

test("audit never labels a namespace", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster(
    namespaces(repository).map((name) => ({ name })),
  );

  await enrollPlatformNamespaces(repository, runner);

  assert.equal(applies(calls).length, 0);
});

test("a second run changes nothing once every namespace is labelled", async () => {
  const repository = await enforce();
  const exempt = Object.keys(repository.environment.enrollmentExemptions!);
  const { runner, calls } = cluster(
    namespaces(repository).map((name) => ({
      name,
      labelled: !exempt.includes(name),
      ownedByKore: !exempt.includes(name),
    })),
  );

  await enrollPlatformNamespaces(repository, runner);

  assert.equal(applies(calls).length, 0);
});

test("a namespace that left the catalog or became exempt loses the label kore applied", async () => {
  const repository = await enforce();
  const { runner, calls } = cluster([
    ...namespaces(repository).map((name) => ({ name })),
    { name: "retired", labelled: true, ownedByKore: true },
  ]);
  const exempted = cluster(
    namespaces(repository).map((name) => ({
      name,
      labelled: name === "cosign-system",
      ownedByKore: name === "cosign-system",
    })),
  );

  await enrollPlatformNamespaces(repository, runner);
  await enrollPlatformNamespaces(repository, exempted.runner);

  const released = (list: typeof calls) =>
    applies(list).filter(
      ({ input }) => !input.includes("policy.sigstore.dev/include"),
    );
  assert.deepEqual(released(calls).map(appliedName), ["retired"]);
  assert.deepEqual(released(exempted.calls).map(appliedName), [
    "cosign-system",
  ]);
  assert.ok(
    released(calls)[0]!.args.includes("--field-manager=kore-enrollment"),
  );
});

test("audit also releases a label kore applied earlier but never touches one it does not own", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster([
    { name: "observability", labelled: true, ownedByKore: true },
    { name: "app-ns", labelled: true },
  ]);

  await enrollPlatformNamespaces(repository, runner);

  assert.deepEqual(applies(calls).map(appliedName), ["observability"]);
});

test("a platform namespace that does not exist fails with the fix", async () => {
  const repository = await enforce();
  const { runner } = cluster([]);

  await assert.rejects(
    enrollPlatformNamespaces(repository, runner),
    /namespace .* does not exist.*kore platform up/s,
  );
});
