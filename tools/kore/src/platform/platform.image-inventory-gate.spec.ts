import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { openApplicationAdmission } from "./bootstrap.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0056-platform-image-inventory.md
// The inventory is a status row; enforce findings keep the gate closed.

function runnerWith(applied: string[], badImage: boolean): Runner {
  return {
    async run(command, args, options) {
      const joined = args.join(" ");
      if (command === "helm") {
        return {
          stdout: JSON.stringify({ info: { status: "deployed" } }),
          stderr: "",
          code: 0,
        };
      }
      if (joined.includes("apply")) {
        applied.push(options?.input ?? "");
        return { stdout: "", stderr: "", code: 0 };
      }
      if (joined.includes("get pods")) {
        return {
          stdout: JSON.stringify({
            items: badImage
              ? [
                  {
                    metadata: { namespace: "observability", name: "x" },
                    status: { phase: "Running" },
                    spec: { containers: [{ name: "c", image: "busybox:1" }] },
                  },
                ]
              : [],
          }),
          stderr: "",
          code: 0,
        };
      }
      if (joined.includes("get namespaces")) {
        return { stdout: JSON.stringify({ items: [] }), stderr: "", code: 0 };
      }
      return { stdout: "available", stderr: "", code: 0 };
    },
  };
}

async function managedWithoutComponents() {
  const repository = await loadRepository("managed-example");
  const component = repository.catalog.components.find(
    (c) => c.namespace === "observability" && c.kind === "helm",
  )!;
  repository.catalog.components = [
    { ...component, dependencies: [], readiness: [] },
  ];
  return repository;
}

test("platform status carries the image inventory row with its findings", async () => {
  const repository = await managedWithoutComponents();

  const rows = await platformStatus(repository, runnerWith([], true));
  const row = rows.find((r) => r.name === "image-inventory");

  assert.equal(row?.status, "degraded");
  assert.equal(row?.inventory?.images.length, 1);
});

test("a filtered status omits the cluster-wide inventory row", async () => {
  const repository = await managedWithoutComponents();

  const rows = await platformStatus(repository, runnerWith([], true), ["x"]);

  assert.equal(rows.length, 0);
});

test("enforce findings keep the gate closed and name the image", async () => {
  const repository = await managedWithoutComponents();
  const applied: string[] = [];

  await assert.rejects(
    openApplicationAdmission(repository, runnerWith(applied, true)),
    /image-inventory.*busybox:1 \(tag-only\)/,
  );
  assert.equal(applied.length, 1);
  assert.match(applied[0]!, /"state":"closed"/);
});
