import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  enabledComponents,
  featureEnabled,
  loadRepository,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md

const externalDnsFlag = "external-dns";
const overlays = ["local", "vps", "managed-example"];

for (const name of overlays) {
  test(`${name} declares external-dns off, so no external-dns is installed (dark until a live outcome)`, async () => {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[externalDnsFlag], false);
    assert.equal(
      featureEnabled(repository.environment, externalDnsFlag),
      false,
    );
    assert.equal(
      enabledComponents(repository).some((c) => c.name === "external-dns"),
      false,
    );
  });
}

test("the external-dns component is gated by its flag, in its own namespace, behind the platform config", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components?.find(
    (c) => c.name === "external-dns",
  );
  assert.equal(component?.namespace, "kore-external-dns");
  assert.equal(component?.featureFlag, externalDnsFlag);
  assert.deepEqual(component?.dependencies, ["kore-platform-config"]);
  assert.deepEqual(component?.readiness, ["deployment/external-dns"]);
});

test("the chart version is the pinned external-dns version and the image is the approved digest", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.components["external-dns"], "1.24.0");
  const image = repository.versions.images["external-dns"];
  const approved = repository.approved?.images.find(
    (entry) => entry.name === "external-dns",
  );
  assert.equal(
    image,
    "registry.k8s.io/external-dns/external-dns:v0.24.0@sha256:a80a146d2540fa138565e404f0625157271071a06093021f27ae19d8316d10f9",
  );
  assert.equal(approved?.image, image);
  assert.equal(approved?.component, "external-dns");
});

for (const name of ["vps", "managed-example"]) {
  test(`${name} rewrites the external-dns image to the mirror by its approved digest`, async () => {
    const repository = await loadRepository(name);
    const values = await readFile(
      join(
        repository.root,
        "infra",
        "environments",
        name,
        "values",
        "mirror",
        "external-dns.yaml",
      ),
      "utf8",
    );
    const parsed = JSON.parse(values) as {
      image: { repository: string; tag: string };
    };
    assert.equal(
      parsed.image.repository,
      "ghcr.io/corekraft/kore/mirror/external-dns",
    );
    assert.match(
      parsed.image.tag,
      /@sha256:a80a146d2540fa138565e404f0625157271071a06093021f27ae19d8316d10f9$/,
    );
  });
}

test("turning external-dns on in vps is refused before any mutation until the placeholder domain and the run-time values are set, naming each", async () => {
  const names = [
    "KORE_PLATFORM_DOMAIN",
    "KORE_PUBLIC_IPV4",
    "KORE_CLOUDFLARE_ZONE_ID",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  for (const name of names) {
    delete process.env[name];
  }
  try {
    const repository = await loadRepository("vps");
    const on = {
      ...repository,
      environment: {
        ...repository.environment,
        features: {
          ...repository.environment.features,
          "external-dns": true,
          "external-gateway": true,
          "service-listener-sets": true,
          "platform-shared-gateway": true,
        },
      },
    };
    await assert.rejects(validateRepository(on), (error: Error) => {
      for (const name of names) {
        assert.match(error.message, new RegExp(name));
      }
      return true;
    });
  } finally {
    names.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

test("the local, vps and managed overlays validate with the external-dns flag declared off", async () => {
  for (const name of overlays) {
    await validateRepository(await loadRepository(name));
  }
});
