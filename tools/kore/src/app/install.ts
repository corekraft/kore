import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Repository } from "../config/index.js";
import {
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  registryPullSecret,
  type LockedImage,
} from "../images/index.js";
import {
  argsFingerprint,
  releaseMatchesFingerprint,
} from "../platform/index.js";
import type { Runner } from "../runtime/index.js";
import { activationLabel } from "../platform/admission-gate.js";
import { releaseArgs } from "./release.js";

async function chart(
  repository: Repository,
  name: string,
  kind: "resources" | "workload",
): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`invalid application name: ${name}`);
  }
  const path = join(repository.root, "apps", name, "charts", kind);
  await access(join(path, "Chart.yaml"));
  return path;
}

export interface Charts {
  resources: string;
  workload: string;
}

export async function resolveCharts(
  repository: Repository,
  name: string,
): Promise<Charts> {
  return {
    resources: await chart(repository, name, "resources"),
    workload: await chart(repository, name, "workload"),
  };
}

const admissionLabel = "policy.sigstore.dev/include";

/**
 * `kore app up` is the single owner of an application namespace, its mesh
 * enrollment (ADR 0025), and its Sigstore admission enrollment (ADR 0032).
 * Helm's `--create-namespace` cannot label, so the namespace is applied here
 * and no release creates it. Enrollment is mandatory: the label is read back
 * and the release is refused when it is absent.
 */
export async function enrollNamespace(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}\n  labels:\n    istio.io/dataplane-mode: ambient\n    ${admissionLabel}: "true"\n`,
    },
  );
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "namespace",
      name,
      "--output",
      `jsonpath={.metadata.labels.${admissionLabel.replaceAll(".", "\\.")}}`,
    ],
    { capture: true },
  );
  if (stdout.trim() !== "true") {
    throw new Error(
      `namespace ${name} is not enrolled in image admission: label ${admissionLabel}="true" is missing after apply. Rerun kore app up (it applies the label); if it persists, another field manager is removing it`,
    );
  }
  await distributeSignatureCredential(repository, runner, name);
}

/**
 * Activates the namespace for one platform generation (ADR 0054): the
 * `activationLabel` names the generation of the open admission gate, so a
 * namespace activated under an earlier generation is stale. The cluster policy
 * lets only bootstrap automation set it. The label is read back and the release
 * is refused when it is absent.
 */
export async function activateNamespace(
  repository: Repository,
  runner: Runner,
  name: string,
  generation: string,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-activation",
      "--force-conflicts",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}\n  labels:\n    ${activationLabel}: ${generation}\n`,
    },
  );
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "namespace",
      name,
      "--output",
      `jsonpath={.metadata.labels.${activationLabel.replaceAll(".", "\\.")}}`,
    ],
    { capture: true },
  );
  if (stdout.trim() !== generation) {
    throw new Error(
      `namespace ${name} is not activated: label ${activationLabel}=${generation} is missing after apply. Rerun kore app up; if it persists, the admission policy is refusing the label because the gate is not open for generation ${generation}`,
    );
  }
}

/**
 * Crossplane composes a claim's connection Secret in the claim's namespace, so
 * it gets the kore-owned `crossplane-postgresql-secrets` ClusterRole through a
 * RoleBinding in each application namespace and nowhere else (ADR 0061). The
 * namespace must already exist; platform namespaces, kore-system above all,
 * are refused so Crossplane can never read the local signing key.
 */
export async function bindCrossplaneSecrets(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<void> {
  const platform = new Set([
    "kore-system",
    "kube-system",
    ...repository.catalog.components.map((component) => component.namespace),
  ]);
  if (platform.has(namespace)) {
    throw new Error(
      `refusing to grant Crossplane Secret access in platform namespace ${namespace}; only application namespaces are bound`,
    );
  }
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--force-conflicts",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "RoleBinding",
        metadata: { name: "crossplane-postgresql-secrets", namespace },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "ClusterRole",
          name: "crossplane-postgresql-secrets",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: "crossplane",
            namespace: "crossplane-system",
          },
        ],
      }),
    },
  );
}

/**
 * Policy Controller reads an image's signatures with the Secret that the
 * kore-platform-images authority names in `source.signaturePullSecrets`, looked
 * up in the namespace of the workload being admitted and with no ServiceAccount
 * (verified against policy-controller v0.13.1, ADR 0034). The enrolled
 * namespace therefore gets the read-only identity, never the push credential.
 * App-owned ServiceAccounts are left alone. Environments using an external
 * registry keep the provider's credentials.
 */
async function distributeSignatureCredential(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<void> {
  if (!koreManagesRegistryAuth(repository)) {
    return;
  }
  const credential = await loadRegistryCredential(repository, runner, "read");
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--force-conflicts",
      "--filename=-",
    ],
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: [
          registryPullSecret(
            registryAddress(repository),
            credential,
            namespace,
          ),
        ],
      }),
    },
  );
}

/**
 * Upgrades an app release unless it is already deployed from the same desired
 * state: the Helm arguments (which carry the image digest, the registry address
 * and the gateway settings) and the chart's content. The fingerprint is stored
 * as the revision description, like a platform component's. Returns whether it
 * upgraded.
 */
async function installRelease(
  repository: Repository,
  runner: Runner,
  name: string,
  target: { release: string; chartPath: string; image?: LockedImage },
): Promise<boolean> {
  const { release, chartPath, image } = target;
  const args = releaseArgs(repository, name, release, chartPath, image);
  const fingerprint = argsFingerprint(
    args.map((arg) =>
      arg === chartPath ? relative(repository.root, chartPath) : arg,
    ),
    chartPath,
  );
  if (
    await releaseMatchesFingerprint(
      repository,
      runner,
      { name: release, namespace: name },
      fingerprint,
    )
  ) {
    return false;
  }
  await runner.run("helm", [...args, "--description", fingerprint], {
    capture: false,
  });
  return true;
}

export async function installResources(
  repository: Repository,
  runner: Runner,
  name: string,
  charts: Charts,
): Promise<void> {
  await installRelease(repository, runner, name, {
    release: `${name}-resources`,
    chartPath: charts.resources,
  });
}

export async function installWorkload(
  repository: Repository,
  runner: Runner,
  name: string,
  charts: Charts,
  image: LockedImage,
): Promise<void> {
  await installRelease(repository, runner, name, {
    release: name,
    chartPath: charts.workload,
    image,
  });
}
