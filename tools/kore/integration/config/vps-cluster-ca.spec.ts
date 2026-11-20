import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Docs: docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md

function certificateRender(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-local-tls",
  );
  assert.ok(component, "kore-local-tls is in the catalog");
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

/** The overlay with in-cluster-ca set as given, every other flag as the overlay holds it. */
async function withCa(name: string, on: boolean): Promise<Repository> {
  const repository = await loadRepository(name);
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, "in-cluster-ca": on },
    },
  };
}

/** Each rendered document as its kind, name and text, in render order. */
function documents(
  rendered: string,
): { kind: string; name: string; text: string }[] {
  return rendered
    .split(/^---$/m)
    .map((text) => text.trim())
    .filter((text) => /^kind:/m.test(text))
    .map((text) => ({
      kind: /^kind: (\S+)$/m.exec(text)![1]!,
      name: /^ {2}name: (\S+)$/m.exec(text)![1]!,
      text,
    }));
}

test("with in-cluster-ca on, the vps certificate release creates the cluster's own self-signed root CA: a SelfSigned issuer, a CA Certificate, and the CA ClusterIssuer the gateway certificate names", async () => {
  const docs = documents(certificateRender(await withCa("vps", true)));
  // Helm orders the documents by kind; cert-manager reconciles in any order.
  assert.deepEqual(docs.map(({ kind, name }) => `${kind}/${name}`).sort(), [
    "Certificate/kore-local",
    "Certificate/kore-local-ca",
    "ClusterIssuer/kore-local-ca",
    "ClusterIssuer/kore-local-selfsigned",
  ]);
  const byName = (kind: string, name: string) =>
    docs.find((d) => d.kind === kind && d.name === name)!;
  const selfSigned = byName("ClusterIssuer", "kore-local-selfsigned");
  const ca = byName("Certificate", "kore-local-ca");
  const issuer = byName("ClusterIssuer", "kore-local-ca");
  const gateway = byName("Certificate", "kore-local");
  assert.match(selfSigned.text, /^spec:\n {2}selfSigned: \{\}$/m);
  assert.match(ca.text, /^ {2}namespace: cert-manager$/m);
  assert.match(ca.text, /^ {2}isCA: true$/m);
  assert.match(ca.text, /^ {2}secretName: kore-local-ca-key-pair$/m);
  assert.match(ca.text, /^ {2}duration: 87600h$/m);
  assert.match(ca.text, /rotationPolicy: Never/);
  assert.match(
    ca.text,
    /issuerRef:\n {4}kind: ClusterIssuer\n {4}name: kore-local-selfsigned/,
  );
  assert.match(
    issuer.text,
    /^spec:\n {2}ca:\n {4}secretName: kore-local-ca-key-pair$/m,
  );
  assert.match(gateway.text, /secretName: kore-local-tls/);
  assert.match(gateway.text, /name: kore-local-ca$/m);
});

test("the vps CA render never carries a Secret, so the CA's private key is created in the cluster and never written into the repository", async () => {
  const rendered = certificateRender(await withCa("vps", true));
  assert.deepEqual(
    documents(rendered).filter(({ kind }) => kind === "Secret"),
    [],
  );
  assert.doesNotMatch(rendered, /BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/);
});

test("with in-cluster-ca off the certificate release creates no issuer, for vps as committed and for local, whose CA kore trust install owns from the mkcert root", async () => {
  for (const name of ["vps", "local"]) {
    const docs = documents(certificateRender(await loadRepository(name)));
    assert.deepEqual(
      docs.map(({ kind, name }) => `${kind}/${name}`),
      ["Certificate/kore-local"],
    );
  }
});

test("in-cluster-ca is listed and off in every overlay until a live run on kore-vps and harness flag activate turn it on", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const { environment } = await loadRepository(name);
    assert.equal(environment.features?.["in-cluster-ca"], false, name);
  }
});
