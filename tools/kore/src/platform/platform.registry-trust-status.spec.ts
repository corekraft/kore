import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { registryTlsSecret } from "../images/registry-tls-fixtures.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0058-registry-transport-tls.md

function runner(caPresent: boolean): Runner {
  return {
    async run(_command, args) {
      if (args.includes("oci-registry-tls")) {
        return {
          stdout: caPresent ? registryTlsSecret : "",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("status reports a missing registry CA as degraded, naming the fix, so the gate stays closed", async () => {
  const repository = await loadRepository("local");
  const rows = await platformStatus(repository, runner(false));
  const row = rows.find(({ name }) => name === "registry-trust");
  expect(row?.status).toBe("degraded");
  expect(row?.detail).toMatch(/kore platform up --env local/);
});

test("status reports the registry CA as ready once it exists", async () => {
  const repository = await loadRepository("local");
  const rows = await platformStatus(repository, runner(true));
  expect(rows.find(({ name }) => name === "registry-trust")?.status).toBe(
    "ready",
  );
});
