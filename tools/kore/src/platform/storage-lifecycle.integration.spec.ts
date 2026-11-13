import assert from "node:assert/strict";
import test from "node:test";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { appDown } from "../app/index.js";
import { retainedResources } from "../cluster/index.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";

type Repository = Awaited<ReturnType<typeof loadRepository>>;
type Kubectl = (args: string[], input?: string) => Promise<string>;

interface Session {
  repository: Repository;
  runner: ProcessRunner;
  kubectl: Kubectl;
}

const CLAIMS = "postgresqlinstances.platform.kore.dev";

// Step 10 live proof: storage profiles, claim readiness, the normalized
// connection Secret, workload-release deletion, retained-claim deletion, and
// the retained-data discovery that gates cluster destroy. It runs against a
// platform already brought up with `kore local up` and only uses the
// CloudNativePG images the composition pins by digest. Secret values are never
// read (only key names), and everything it creates is removed afterwards,
// including the Released volume a retained claim leaves behind.
//
// Run with: npm run test:integration:storage

const NAMESPACE = "kore-storage-it";
const RETAINED = "storage-it-retained";
const DISPOSABLE = "storage-it-disposable";
const CONTRACT_KEYS = [
  "database",
  "host",
  "passwordSecretRef",
  "port",
  "sslmode",
  "username",
];

function claim(name: string, retention: "Delete" | "Retain"): string {
  return JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "PostgreSQLInstance",
    metadata: { name, namespace: NAMESPACE },
    spec: {
      serviceClass: "development",
      storageSize: "1Gi",
      compatibilityVersion: 17,
      connectionSecretName: `${name}-connection`,
      retentionPolicy: retention,
    },
  });
}

function inNamespace(args: string[]): string[] {
  return [`--namespace=${NAMESPACE}`, ...args];
}

function newSession(repository: Repository): Session {
  const runner = new ProcessRunner();
  const context = ["--context", repository.environment.kubeContext];
  const kubectl: Kubectl = async (args, input) => {
    const options = { capture: true, cwd: repository.root };
    const result = await runner.run(
      "kubectl",
      [...context, ...args],
      input === undefined ? options : { ...options, input },
    );
    return result.stdout.trim();
  };
  return { repository, runner, kubectl };
}

// A claim becomes ready from its own conditions; the test never names
// CloudNativePG to learn that.
async function assertReady({ kubectl }: Session, name: string): Promise<void> {
  await kubectl(
    inNamespace([
      "wait",
      "--for=condition=Ready",
      `${CLAIMS}/${name}`,
      "--timeout=15m",
    ]),
  );
  const endpoint = await kubectl(
    inNamespace([
      "get",
      `${CLAIMS}/${name}`,
      "--output=jsonpath={.status.endpoint}",
    ]),
  );
  assert.equal(endpoint, `${name}-rw:5432`, `${name} reports an endpoint`);
}

// Key names only, never values.
async function assertSecretKeys(
  { kubectl }: Session,
  name: string,
): Promise<void> {
  const keys = await kubectl(
    inNamespace([
      "get",
      "secret",
      `${name}-connection`,
      '--output=go-template={{range $key, $value := .data}}{{$key}}{{"\\n"}}{{end}}',
    ]),
  );
  assert.deepEqual(keys.split("\n").sort(), CONTRACT_KEYS, name);
}

async function storageClassOf(
  { kubectl }: Session,
  name: string,
): Promise<string> {
  return await kubectl(
    inNamespace([
      "get",
      "pvc",
      `--selector=cnpg.io/cluster=${name}`,
      "--output=jsonpath={.items[*].spec.storageClassName}",
    ]),
  );
}

async function assertWorkloadDeletionKeepsClaims(
  session: Session,
): Promise<void> {
  await appDown(session.repository, session.runner, NAMESPACE);
  for (const name of [RETAINED, DISPOSABLE]) {
    await session.kubectl(
      inNamespace(["get", `${CLAIMS}/${name}`, "--output=name"]),
    );
  }
  assert.ok(
    (await storageClassOf(session, RETAINED)).length > 0,
    "retained PVC remains",
  );
}

// Deleting the retained claim keeps its volume, and discovery still reports
// it, which is what blocks cluster destroy without a purge.
async function assertRetainedDeletionKeepsData(
  session: Session,
  volumes: Set<string>,
): Promise<void> {
  const { repository, runner, kubectl } = session;
  const persistent = (found: string[]) =>
    found.filter((resource) => resource.startsWith("persistentvolume/"));
  const bound = persistent(
    await retainedResources(repository, runner, NAMESPACE),
  );
  bound.forEach((volume) => volumes.add(volume));
  await kubectl(
    inNamespace(["delete", `${CLAIMS}/${RETAINED}`, "--wait", "--timeout=10m"]),
  );
  const kept = persistent(
    await retainedResources(repository, runner, NAMESPACE),
  );
  kept.forEach((volume) => volumes.add(volume));
  assert.ok(kept.length > 0, "retained volume survives claim deletion");
  assert.deepEqual(kept, bound, "discovery reports the volume bound before");
}

// Remove only what this test created. The disposable claim's volume goes with
// its claim (the Delete profile); the retained one is deleted by name here.
async function cleanUp({ kubectl }: Session, volumes: Set<string>) {
  const quietly = (args: string[]) => kubectl(args).catch(() => undefined);
  for (const name of [RETAINED, DISPOSABLE]) {
    await quietly(
      inNamespace([
        "delete",
        `${CLAIMS}/${name}`,
        "--ignore-not-found",
        "--wait",
        "--timeout=10m",
      ]),
    );
  }
  await quietly([
    "delete",
    "namespace",
    NAMESPACE,
    "--ignore-not-found",
    "--wait",
    "--timeout=10m",
  ]);
  for (const volume of volumes) {
    await quietly(["delete", volume, "--ignore-not-found", "--wait=false"]);
  }
}

test(
  "storage profiles, claims, and retained data behave as Step 10 requires",
  {
    concurrency: false,
    timeout: 25 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
  },
  async () => {
    const session = newSession(
      await loadRepository(integrationEnvironment(), await findRoot()),
    );
    const volumes = new Set<string>();
    try {
      await session.kubectl(["create", "namespace", NAMESPACE]);
      await session.kubectl(["apply", "-f", "-"], claim(RETAINED, "Retain"));
      await session.kubectl(["apply", "-f", "-"], claim(DISPOSABLE, "Delete"));
      for (const name of [RETAINED, DISPOSABLE]) {
        await assertReady(session, name);
        await assertSecretKeys(session, name);
      }
      assert.equal(await storageClassOf(session, RETAINED), "kore-retained");
      assert.equal(await storageClassOf(session, DISPOSABLE), "kore-standard");
      await assertWorkloadDeletionKeepsClaims(session);
      await assertRetainedDeletionKeepsData(session, volumes);
    } finally {
      await cleanUp(session, volumes);
    }
  },
);
