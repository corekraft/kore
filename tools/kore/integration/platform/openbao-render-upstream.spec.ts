import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { renderChart } from "../../src/testing/index.js";

// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
// Docs: docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md
// Issue: #1592

const digest =
  "sha256:ba4b133eb9586630024e71a617e66f37f29cc3534cdd46a6233e098ceded8dc9";

/** The kinds a rendered release holds, one entry per document, not counting a `helm test` hook pod. */
function kinds(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .filter((document) => !document.includes('"helm.sh/hook": test'))
    .flatMap((document) => {
      const kind = /^kind: (\w+)$/m.exec(document)?.[1];
      return kind === undefined ? [] : [kind];
    });
}

// Opt-in: renders the pinned OpenBao chart with the vps values (needs helm and network).
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "the pinned OpenBao chart renders one replica with Raft storage, the static seal file, one audit device and no injector, CSI or Secret",
  async () => {
    const repository = await loadRepository("vps");
    const component = repository.catalog.components.find(
      ({ name }) => name === "openbao",
    )!;
    const rendered = await renderChart(repository, component);
    const found = kinds(rendered);
    assert.equal(found.filter((kind) => kind === "StatefulSet").length, 1);
    assert.equal(found.includes("Deployment"), false, "no injector");
    assert.equal(found.includes("DaemonSet"), false, "no CSI provider");
    assert.equal(found.includes("Secret"), false, "no Kubernetes Secret");
    assert.equal(found.includes("MutatingWebhookConfiguration"), false);
    assert.equal(found.includes("ClusterRoleBinding"), false);
    assert.match(rendered, /^ {2}replicas: 1$/m);
    assert.match(rendered, /storage "raft" \{/);
    assert.match(
      rendered,
      /current_key = "file:\/\/\/openbao\/seal\/static-seal\.key"/,
    );
    assert.equal(rendered.match(/^ {4}initialize "/gm)?.length, 1);
    assert.match(rendered, /path = "sys\/audit\/file"/);
    assert.ok(
      rendered.includes(
        `ghcr.io/corekraft/kore/mirror/openbao:2.7.3@${digest}`,
      ),
    );
  },
  120_000,
);
