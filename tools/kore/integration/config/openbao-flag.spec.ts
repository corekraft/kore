import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  componentValues,
  enabledComponents,
  featureEnabled,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
// Docs: docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md
// Issue: #1592 (OpenBao on vps as a pinned platform component behind a dark flag)

const run = promisify(execFile);
const flag = "openbao";
const overlays = ["local", "vps", "managed-example"];
const digest =
  "sha256:ba4b133eb9586630024e71a617e66f37f29cc3534cdd46a6233e098ceded8dc9";

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

const isMap = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Helm's merge: maps merge key by key; lists and scalars from a later file replace. */
function merge(base: Json, layer: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const prior = out[key];
    out[key] = isMap(prior) && isMap(value) ? merge(prior, value) : value;
  }
  return out;
}

/** The values Helm renders the vps OpenBao release with: the catalog file, then the vps overlay files. */
async function vpsOpenbaoValues(): Promise<{
  repository: Repository;
  values: Json;
}> {
  const repository = await loadRepository("vps");
  const component = repository.catalog.components.find(
    (c) => c.name === "openbao",
  );
  assert.ok(component, "openbao is a catalog component");
  let values: Json = {};
  for (const path of componentValues(repository, component)) {
    values = merge(
      values,
      JSON.parse(await readFile(join(repository.root, path), "utf8")),
    );
  }
  return { repository, values };
}

for (const name of overlays) {
  test(`${name} declares openbao off, so no OpenBao is installed (dark until a live outcome)`, async () => {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false);
    assert.equal(featureEnabled(repository.environment, flag), false);
    assert.equal(
      enabledComponents(repository).some((c) => c.name === "openbao"),
      false,
    );
  });
}

test("the openbao component is gated by the one existing flag, in its own platform namespace, after the storage classes it claims", async () => {
  const repository = await loadRepository("vps");
  const component = repository.catalog.components.find(
    (c) => c.name === "openbao",
  );
  assert.equal(component?.featureFlag, flag);
  assert.equal(component?.namespace, "openbao");
  assert.equal(component?.kind, "helm");
  assert.equal(component?.repository, "https://openbao.github.io/openbao-helm");
  assert.deepEqual(component?.dependencies, ["kore-storage"]);
  assert.deepEqual(component?.readiness, ["statefulset/openbao"]);
  assert.equal(
    repository.flags.flags.filter((entry) => entry.name === flag).length,
    1,
    "no second flag is declared",
  );
});

test("the chart version is exact, and the image is pinned by the signed digest recorded with the other pins and the compatibility evidence", async () => {
  const repository = await loadRepository("vps");
  assert.equal(repository.versions.components["openbao"], "0.30.8");
  const image = repository.versions.images["openbao"];
  assert.equal(image, `quay.io/openbao/openbao:2.7.3@${digest}`);
  const approved = repository.approved?.images.find(
    (entry) => entry.name === "openbao",
  );
  assert.equal(approved?.image, image);
  assert.equal(approved?.component, "openbao");
  assert.equal(approved?.evidence.method, "cosign-keyless");
  assert.equal(approved?.evidence.provenance.signed, true);
  const compatibility = await readFile(
    join(repository.root, "infra/catalog/compatibility.md"),
    "utf8",
  );
  assert.match(compatibility, /\| OpenBao chart\s+\| 0\.30\.8 /);
  assert.match(compatibility, /\| OpenBao image\s+\| 2\.7\.3 /);
  assert.ok(compatibility.includes(digest));
});

test("the vps render pulls the image by its approved digest, from the upstream registry in the catalog values and from the mirror in the vps overlay", async () => {
  const { repository, values } = await vpsOpenbaoValues();
  assert.equal(values.server.image.registry, "ghcr.io");
  assert.equal(values.server.image.repository, "corekraft/kore/mirror/openbao");
  assert.equal(values.server.image.tag, `2.7.3@${digest}`);
  const common: unknown = JSON.parse(
    await readFile(
      join(repository.root, "infra/environments/common/values/openbao.yaml"),
      "utf8",
    ),
  );
  assert.ok(isMap(common));
  assert.equal(common["server"].image.repository, "openbao/openbao");
  assert.equal(common["server"].image.tag, `2.7.3@${digest}`);
});

test("the vps render is one replica with Raft storage, the injector and CSI sub-charts off, and nothing that adds a second owner of OpenBao's configuration", async () => {
  const { values } = await vpsOpenbaoValues();
  assert.equal(values.injector.enabled, false);
  assert.equal(values.csi.enabled, false);
  assert.equal(values.server.ha.enabled, true);
  assert.equal(values.server.ha.replicas, 1);
  assert.equal(values.server.ha.raft.enabled, true);
  assert.equal(values.server.authDelegator.enabled, false);
  assert.equal(values.ui.enabled, false);
  const config: string = values.server.ha.raft.config;
  assert.match(config, /storage "raft" \{/);
  assert.doesNotMatch(config, /storage "(?!raft)/);
  assert.doesNotMatch(config, /retry_join/);
});

test("the static seal reads a file path on the memory volume, never a literal key, and the key's host directory is the one the openbao host role places it in", async () => {
  const { repository, values } = await vpsOpenbaoValues();
  const config: string = values.server.ha.raft.config;
  assert.match(
    config,
    /seal "static" \{\s+current_key_id = "[a-z0-9-]+"\s+current_key = "file:\/\/\/openbao\/seal\/static-seal\.key"\s+\}/,
  );
  assert.equal(config.match(/seal "/g)?.length, 1);
  const role = await readFile(
    join(repository.root, "infra/hosts/vps/roles/openbao/defaults/main.yaml"),
    "utf8",
  );
  assert.match(role, /^openbao_seal_key_dir: \/etc\/kore\/openbao$/m);
  const hostPath = values.server.volumes.find(
    (volume: Json) => volume.name === "seal-host",
  ).hostPath;
  assert.deepEqual(hostPath, { path: "/etc/kore/openbao", type: "Directory" });
  const memory = values.server.volumes.find(
    (volume: Json) => volume.name === "seal",
  );
  assert.equal(memory.emptyDir.medium, "Memory");
  const init = values.server.extraInitContainers[0];
  assert.equal(init.name, "place-seal-key");
  assert.deepEqual(
    init.volumeMounts.find((mount: Json) => mount.name === "seal-host"),
    { name: "seal-host", mountPath: "/seal-host", readOnly: true },
  );
  // The main container reads the copy and cannot write it; the host file is mounted only into the init container.
  assert.deepEqual(values.server.volumeMounts, [
    { name: "seal", mountPath: "/openbao/seal", readOnly: true },
  ]);
  assert.equal(JSON.stringify(values).includes("secretKeyRef"), false);
});

test("exactly one self-initialization request runs, and it enables the file audit device, so OpenBao starts audit-only", async () => {
  const { values } = await vpsOpenbaoValues();
  const config: string = values.server.ha.raft.config;
  assert.equal(config.match(/^initialize "/gm)?.length, 1);
  assert.equal(config.match(/^\s+request "/gm)?.length, 1);
  assert.match(config, /initialize "audit" \{\s+request "enable-audit" \{/);
  assert.match(config, /path = "sys\/audit\/file"/);
  assert.match(config, /type = "file"/);
  assert.match(config, /file_path = "\/openbao\/audit\/audit\.log"/);
  for (const other of [
    "sys/auth",
    "sys/policies",
    "sys/mounts",
    "auth/",
    "secret/",
  ]) {
    assert.equal(config.includes(other), false, `no request touches ${other}`);
  }
  assert.equal(values.server.auditStorage.enabled, true);
});

test("the openbao readiness is a catalog step of its own, so the readiness table lists it", async () => {
  const repository = await loadRepository("vps");
  const requirement = repository.readiness?.requirements.find(
    (entry) => entry.name === "openbao",
  );
  assert.deepEqual(requirement?.components, ["openbao"]);
});

test("with openbao off the platform charts render byte-identical to a catalog that has no openbao flag at all", async () => {
  const rendered: string[] = [];
  for (const name of ["vps", "local"]) {
    const off = await loadRepository(name);
    const features = { ...off.environment.features };
    delete features[flag];
    const absent: Repository = {
      ...off,
      environment: { ...off.environment, features },
    };
    for (const component of off.catalog.components) {
      if (component.kind !== "local-chart" || component.featureFlag) {
        continue;
      }
      const render = async (repository: Repository) =>
        (
          await run(
            "helm",
            withAbsoluteChart(
              repository,
              component,
              helmTemplateArgs(repository, component),
            ),
            { cwd: repository.root, maxBuffer: 64 * 1024 * 1024 },
          )
        ).stdout;
      const [withOff, without] = [await render(off), await render(absent)];
      assert.equal(withOff, without, `${name} ${component.name}`);
      rendered.push(`${name}/${component.name}`);
    }
  }
  assert.ok(rendered.length >= 5, `rendered ${rendered.length} charts`);
}, 60_000);
