import { enabledComponents, type Repository } from "../config/index.js";
import { managedNamespaces } from "./gated-release.js";
import type { Runner } from "../runtime/index.js";
import { enrollmentLabel } from "./image-inventory.js";

/**
 * Policy Controller enrollment of the catalog-managed platform namespaces
 * (plan Step 7, ADR 0056). Enrollment follows the environment's inventory mode:
 * `enforce` labels every platform namespace except the declared exemptions,
 * `audit` labels none. Helm still creates the namespaces; kore owns only the
 * inclusion label, as server-side-apply field manager `kore-enrollment`, so no
 * other tool contests it and dropping the field releases it.
 */
export const enrollmentFieldManager = "kore-enrollment";

/**
 * Mesh enrollment of the namespaces whose catalog component sets
 * `meshEnrolled`: the ambient dataplane label, owned as `kore-mesh-enrollment`
 * so it never contests the inclusion label above. It applies in every
 * inventory mode and releases when the component is gated off again.
 */
export const meshFieldManager = "kore-mesh-enrollment";
const ambientLabel = "istio.io/dataplane-mode";

interface NamespaceList {
  items?: {
    metadata: {
      name: string;
      labels?: Record<string, string>;
      managedFields?: { manager?: string }[];
    };
  }[];
}

/** One label and the server-side-apply manager that owns it. */
interface LabelOwner {
  label: string;
  value: string;
  manager: string;
}

const imageOwner: LabelOwner = {
  label: enrollmentLabel,
  value: "true",
  manager: enrollmentFieldManager,
};
const meshOwner: LabelOwner = {
  label: ambientLabel,
  value: "ambient",
  manager: meshFieldManager,
};

async function apply(
  repository: Repository,
  runner: Runner,
  name: string,
  labelled: boolean,
  owner: LabelOwner = imageOwner,
): Promise<void> {
  const labels = labelled
    ? `\n  labels:\n    ${owner.label}: ${JSON.stringify(owner.value)}`
    : "";
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      `--field-manager=${owner.manager}`,
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}${labels}\n`,
    },
  );
}

/**
 * Brings the label in line with the catalog and the exemptions. Run after every
 * platform phase, so Policy Controller and the image policies are ready and its
 * own release was never verified by itself, and before the inventory reads the
 * result. Idempotent: it only applies what differs.
 */
export async function enrollPlatformNamespaces(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { environment } = repository;
  const exempt = environment.enrollmentExemptions ?? {};
  const desired =
    environment.imageInventory === "enforce"
      ? (await managedNamespaces(repository, runner))
          .filter((namespace) => !(namespace in exempt))
          .sort()
      : [];
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      environment.kubeContext,
      "get",
      "namespaces",
      "--show-managed-fields",
      "-o",
      "json",
    ],
    { capture: true },
  );
  const existing = new Map(
    ((JSON.parse(stdout) as NamespaceList).items ?? []).map((ns) => [
      ns.metadata.name,
      ns.metadata,
    ]),
  );
  const missing = desired.filter((namespace) => !existing.has(namespace));
  if (missing.length) {
    throw new Error(
      `cannot enroll platform namespace ${missing.join(", ")}: namespace ${missing.join(", ")} does not exist. Its release did not create it; fix that release and rerun kore platform up`,
    );
  }
  for (const namespace of desired) {
    if (existing.get(namespace)?.labels?.[enrollmentLabel] !== "true") {
      await apply(repository, runner, namespace, true);
    }
  }
  // Only a label this manager applied is released; another owner's is never touched.
  const wanted = new Set(desired);
  for (const [namespace, metadata] of existing) {
    if (
      !wanted.has(namespace) &&
      metadata.managedFields?.some(
        ({ manager }) => manager === enrollmentFieldManager,
      )
    ) {
      await apply(repository, runner, namespace, false);
    }
  }
  await enrollAmbient(repository, runner, existing);
}

async function enrollAmbient(
  repository: Repository,
  runner: Runner,
  existing: Map<
    string,
    { labels?: Record<string, string>; managedFields?: { manager?: string }[] }
  >,
): Promise<void> {
  const desired = [
    ...new Set(
      enabledComponents(repository)
        .filter(({ meshEnrolled }) => meshEnrolled)
        .map(({ namespace }) => namespace),
    ),
  ].sort();
  const missing = desired.filter((namespace) => !existing.has(namespace));
  if (missing.length) {
    throw new Error(
      `cannot enroll platform namespace ${missing.join(", ")} in the mesh: namespace ${missing.join(", ")} does not exist. Its release did not create it; fix that release and rerun kore platform up`,
    );
  }
  const applyMesh = (namespace: string, labelled: boolean) =>
    apply(repository, runner, namespace, labelled, meshOwner);
  for (const namespace of desired) {
    if (existing.get(namespace)?.labels?.[ambientLabel] !== "ambient") {
      await applyMesh(namespace, true);
    }
  }
  const wanted = new Set(desired);
  for (const [namespace, metadata] of existing) {
    if (
      !wanted.has(namespace) &&
      metadata.managedFields?.some(
        ({ manager }) => manager === meshFieldManager,
      )
    ) {
      await applyMesh(namespace, false);
    }
  }
}
