import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1824 (for #1747). With golden-path-signin on, the BFF's JVM must
// trust the local cluster CA, or Spring's discovery of the Keycloak issuer fails
// PKIX path building. The workload renders a Certificate whose Secret carries
// ca.crt and a truststore init container; with the flag off none of it renders.

const run = promisify(execFile);
const frontendImage = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const issuer = "https://keycloak.kore.internal/realms/platform";
const host = "auth.acme.kore.internal";

async function render(...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    ...set,
  ]);
  return stdout;
}

const documents = (stdout: string) =>
  stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
const kindOf = (doc: string) => /^kind: (\w+)$/m.exec(doc)![1];

const workload = [
  "--set",
  "service=auth",
  "--set",
  `frontend.image=${frontendImage}`,
  "--set",
  `bff.image=${bff}`,
];
const workloadIngress = [
  "--set",
  "ingress.host=" + host,
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
];
const signinOn = [
  "--set",
  "signin.enabled=true",
  "--set-string",
  `signin.issuerUri=${issuer}`,
];

const signinDocs = async (...extra: string[]) =>
  documents(
    await render(...workload, ...workloadIngress, ...signinOn, ...extra),
  );
const deploymentOf = (docs: string[], name: string) =>
  docs.find(
    (doc) =>
      kindOf(doc) === "Deployment" && doc.includes(`\n  name: ${name}\n`),
  )!;

test("with golden-path-signin on the workload renders a cert-manager Certificate whose Secret carries the local CA, issued by the ingress issuer", async () => {
  const certificates = (await signinDocs()).filter(
    (doc) =>
      kindOf(doc) === "Certificate" && doc.includes("name: auth-bff-ca\n"),
  );
  expect(certificates).toHaveLength(1);
  const certificate = certificates[0]!;
  expect(certificate).toContain("apiVersion: cert-manager.io/v1\n");
  expect(certificate).toContain("metadata:\n  name: auth-bff-ca\n");
  expect(certificate).toContain("  secretName: auth-bff-ca\n");
  expect(certificate).toContain(
    "  issuerRef:\n    kind: ClusterIssuer\n    name: kore-local-ca\n",
  );
});

test("the BFF CA Certificate follows ingress.issuer when the Service sets one", async () => {
  const docs = documents(
    await render(
      ...workload,
      "--set",
      "ingress.host=" + host,
      "--set",
      "ingress.gatewayClassName=agentgateway",
      "--set",
      "ingress.issuer=other-ca",
      ...signinOn,
    ),
  );
  const certificate = docs.find(
    (doc) =>
      kindOf(doc) === "Certificate" && doc.includes("name: auth-bff-ca\n"),
  )!;
  expect(certificate).toContain("    name: other-ca\n");
  expect(certificate).not.toContain("kore-local-ca");
});

test("with golden-path-signin on the BFF builds a truststore of the JDK roots plus the local CA in an init container, and the frontend is untouched", async () => {
  const docs = await signinDocs();
  const bffDeployment = deploymentOf(docs, "auth-bff");
  expect(bffDeployment).toContain(`      initContainers:
        - name: truststore
          image: "${bff}"
          command:
            - sh
            - -c
            - |
              set -eu
              cp "$JAVA_HOME/lib/security/cacerts" /truststore/cacerts
              chmod u+w /truststore/cacerts
              keytool -importcert -noprompt -alias kore-local-ca -file /ca/ca.crt -keystore /truststore/cacerts -storepass changeit
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
          volumeMounts:
            - {name: truststore, mountPath: /truststore}
            - {name: bff-ca, mountPath: /ca, readOnly: true}
`);
  expect(bffDeployment).toContain(`      volumes:
        - name: truststore
          emptyDir: {}
        - name: bff-ca
          secret:
            secretName: auth-bff-ca
            items:
              - {key: ca.crt, path: ca.crt}
`);
  const frontendDeployment = deploymentOf(docs, "auth-frontend");
  expect(frontendDeployment).not.toMatch(
    /initContainers|volumes|truststore|JAVA_TOOL_OPTIONS|bff-ca/,
  );
});

test("with golden-path-signin on only the bff container gets JAVA_TOOL_OPTIONS pointing at the truststore, and never mounts the private key", async () => {
  const bffDeployment = deploymentOf(await signinDocs(), "auth-bff");
  expect(bffDeployment).toContain(`            - name: JAVA_TOOL_OPTIONS
              value: "-Djavax.net.ssl.trustStore=/truststore/cacerts -Djavax.net.ssl.trustStorePassword=changeit"
`);
  expect(bffDeployment).toContain(`          volumeMounts:
            - {name: truststore, mountPath: /truststore, readOnly: true}
`);
  expect(bffDeployment).not.toMatch(/tls\.key|auth-tls/);
  expect(bffDeployment.match(/JAVA_TOOL_OPTIONS/g)).toHaveLength(1);
});

test("with golden-path-signin off the workload renders no truststore, no BFF CA Certificate and no JAVA_TOOL_OPTIONS", async () => {
  const rendered = await render(...workload, ...workloadIngress);
  expect(rendered).not.toMatch(
    /initContainers|truststore|bff-ca|JAVA_TOOL_OPTIONS|trustStore/,
  );
});
