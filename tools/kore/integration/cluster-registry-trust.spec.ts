// Docs: docs/decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md
// The k3d registry trust over a real host directory: the registries file, the
// trust write, and the cluster up that writes first. Real units together with a
// fake runner; no cluster or network is touched (ADR 0098).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { clusterUp } from "../src/cluster/index.js";
import {
  ensureRegistryTrust,
  writeK3dRegistriesConfig,
} from "../src/images/index.js";
import type { Runner } from "../src/runtime/index.js";
import { fakeRunner, fast, k3dRepository } from "../src/testing/index.js";

// Registry trust over a real host directory (ADR 0084): real writes, no cluster.
const TRUST_PEM =
  "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const REGISTRY = "10.96.0.50:5000";

/** A runner whose registry TLS secret carries `ca` as ca.crt, as the cluster would answer. */
function caRunner(ca: string): Runner {
  return {
    async run(_command, args) {
      return {
        stdout: args.includes("oci-registry-tls")
          ? JSON.stringify({
              data: { "ca.crt": Buffer.from(ca).toString("base64") },
            })
          : "",
        stderr: "",
        code: 0,
      };
    },
  };
}

test("the written registries.yaml names the registry and its CA file, and sets no insecure, skip, mirror or endpoint option", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-registries-"));
  try {
    const directory = join(home, "registry-trust");
    await writeK3dRegistriesConfig(directory, REGISTRY);
    const registries = await readFile(
      join(directory, "registries.yaml"),
      "utf8",
    );
    assert.ok(registries.includes(`"${REGISTRY}":`));
    assert.ok(registries.includes("ca_file: /etc/kore/registry-ca/ca.crt"));
    assert.doesNotMatch(registries, /insecure|skip|mirrors|endpoint/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("cluster up writes the registries file before it creates the cluster, so the mount source is never missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-order-"));
  try {
    const registriesPath = join(
      home,
      ".kore",
      "k3d",
      "kore-local",
      "registry-trust",
      "registries.yaml",
    );
    const { runner } = fakeRunner(undefined);
    let atCreate = "";
    const watching: Runner = {
      async run(command, args, options) {
        if (command === "k3d" && args[1] === "create") {
          atCreate = await readFile(registriesPath, "utf8");
        }
        return runner.run(command, args, options);
      },
    };
    await clusterUp(await k3dRepository(), watching, fast, home);
    assert.ok(atCreate.includes(`"${REGISTRY}":`));
    assert.ok(atCreate.includes("ca_file: /etc/kore/registry-ca/ca.crt"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("two registry trust writes swap the CA and leave exactly ca.crt in the trust directory", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-swap-"));
  try {
    const trustDirectory = join(
      home,
      ".kore",
      "k3d",
      "kore-local",
      "registry-trust",
    );
    const second = TRUST_PEM.replace("QUJD", "REVG");
    for (const ca of [TRUST_PEM, second]) {
      await ensureRegistryTrust(await k3dRepository(), caRunner(ca), home);
    }
    assert.equal(
      await readFile(join(trustDirectory, "ca.crt"), "utf8"),
      second,
    );
    assert.deepEqual(await readdir(trustDirectory), ["ca.crt"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("the CA written to disk is the public certificate and never carries private key material", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-public-"));
  try {
    await ensureRegistryTrust(await k3dRepository(), caRunner(TRUST_PEM), home);
    const written = await readFile(
      join(home, ".kore", "k3d", "kore-local", "registry-trust", "ca.crt"),
      "utf8",
    );
    assert.equal(written, TRUST_PEM);
    assert.doesNotMatch(written, /PRIVATE KEY/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
