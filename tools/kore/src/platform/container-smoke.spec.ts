import assert from "node:assert/strict";
import { test } from "vitest";
import {
  classifySmokeLogs,
  dockerRunArgs,
  smokeTargets,
} from "./container-smoke.js";

const digest =
  "sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c";

test("the registry's real debug-listener crash is a smoke failure", () => {
  const logs = [
    'time="2026-11-07T10:00:00Z" level=info msg="starting"',
    'level=fatal msg="error listening on debug interface: listen tcp :5001: bind: address already in use"',
  ].join("\n");
  const problems = classifySmokeLogs(logs);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /address already in use/);
});

test("a fatal line without a bind error is still a smoke failure", () => {
  assert.equal(
    classifySmokeLogs('{"level":"fatal","msg":"cannot open config"}').length,
    1,
  );
  assert.equal(classifySmokeLogs("panic: nil pointer dereference").length, 1);
});

test("ordinary startup logs pass, including words that merely contain fatal", () => {
  const logs = [
    'level=info msg="listening on [::]:5000"',
    'level=warning msg="non-fatal: metrics disabled"',
    'level=error msg="retrying upstream"',
  ].join("\n");
  assert.deepEqual(classifySmokeLogs(logs), []);
});

const registryDeployment = {
  kind: "Deployment",
  metadata: { name: "oci-registry", namespace: "kore-system" },
  spec: {
    template: {
      spec: {
        containers: [
          {
            name: "registry",
            image: `registry:3.1.2@${digest}`,
            args: ["serve", "/etc/distribution/config.yml"],
            env: [{ name: "REGISTRY_HTTP_ADDR", value: ":5000" }],
            volumeMounts: [{ name: "data", mountPath: "/var/lib/registry" }],
          },
        ],
        volumes: [{ name: "data", persistentVolumeClaim: { claimName: "x" } }],
      },
    },
  },
};

test("a container becomes a read-only docker run by digest with its rendered env and args", () => {
  const [target] = smokeTargets([registryDeployment]);
  assert.equal(target!.skip, undefined);
  const args = dockerRunArgs(target!, "kore-smoke-1");
  assert.deepEqual(args.slice(0, 4), ["run", "-d", "--name", "kore-smoke-1"]);
  // A crashed container must keep its logs for the caller to read.
  assert.ok(!args.includes("--rm"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("REGISTRY_HTTP_ADDR=:5000"));
  assert.ok(args.includes("/var/lib/registry"));
  const image = args.indexOf(`registry:3.1.2@${digest}`);
  assert.ok(image > 0);
  assert.deepEqual(args.slice(image + 1), [
    "serve",
    "/etc/distribution/config.yml",
  ]);
});

test("a PVC mount becomes a tmpfs so the read-only container can write where it expects", () => {
  const [target] = smokeTargets([registryDeployment]);
  const args = dockerRunArgs(target!, "n");
  assert.equal(args[args.indexOf("--tmpfs") + 1], "/var/lib/registry");
});

test("containers that need cluster resources are skipped with a reason", () => {
  const needsSecret = structuredClone(registryDeployment);
  needsSecret.spec.template.spec.volumes = [
    { name: "data", secret: { secretName: "s" } },
  ] as never;
  const [secret] = smokeTargets([needsSecret]);
  assert.match(secret!.skip!, /Secret volume data/);

  const needsFieldRef = structuredClone(registryDeployment);
  (needsFieldRef.spec.template.spec.containers[0] as { env: unknown[] }).env = [
    { name: "POD", valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
  ];
  const [field] = smokeTargets([needsFieldRef]);
  assert.match(field!.skip!, /env POD/);
});

test("an image that is not pinned by digest is skipped, never run by tag", () => {
  const byTag = structuredClone(registryDeployment);
  byTag.spec.template.spec.containers[0]!.image = "registry:3.1.2";
  const [target] = smokeTargets([byTag]);
  assert.match(target!.skip!, /digest/);
});

test("non-workload documents contribute no targets", () => {
  assert.deepEqual(smokeTargets([{ kind: "Service" }]), []);
});
