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

/**
 * The label the shared Gateway's listeners select on (ADR 0134), on the
 * namespaces of the components that attach a route to it, owned as
 * `kore-shared-gateway-enrollment`. It applies only while
 * platform-shared-gateway is on and releases when the flag goes off.
 */
export const sharedGatewayFieldManager = "kore-shared-gateway-enrollment";

function sharedGatewayOn(repository: Repository): boolean {
  return repository.environment.features?.["platform-shared-gateway"] === true;
}

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

const sharedGatewayOwner: LabelOwner = {
  label: "platform.kore.dev/shared-gateway",
  value: "true",
  manager: sharedGatewayFieldManager,
};
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
  await enrollOwned(runner, repository, existing, {
    owner: meshOwner,
    purpose: "in the mesh",
    namespaces: enabledComponents(repository)
      .filter(({ meshEnrolled }) => meshEnrolled)
      .map(({ namespace }) => namespace),
  });
  await enrollOwned(runner, repository, existing, {
    owner: sharedGatewayOwner,
    purpose: "for the shared Gateway",
    namespaces: sharedGatewayNamespaces(repository),
  });
}

/**
 * The namespaces of the enabled components that attach a route to the shared
 * Gateway, while platform-shared-gateway is on. A component whose route renders
 * only under its own flag (`sharedGatewayRouteFlag`) counts only while that flag
 * is on too, so the flag off changes no namespace.
 */
function sharedGatewayNamespaces(repository: Repository): string[] {
  if (!sharedGatewayOn(repository)) {
    return [];
  }
  const features = repository.environment.features;
  return enabledComponents(repository)
    .filter(
      ({ sharedGatewayRoutes, sharedGatewayRouteFlag }) =>
        sharedGatewayRoutes &&
        (sharedGatewayRouteFlag === undefined ||
          features?.[sharedGatewayRouteFlag] === true),
    )
    .map(({ namespace }) => namespace);
}

type Existing = Map<
  string,
  { labels?: Record<string, string>; managedFields?: { manager?: string }[] }
>;

/**
 * Keeps one label on exactly the namespaces wanted, under its own manager. A
 * label only this manager applied is released; another owner's is never touched.
 */
async function enrollOwned(
  runner: Runner,
  repository: Repository,
  existing: Existing,
  target: { owner: LabelOwner; purpose: string; namespaces: string[] },
): Promise<void> {
  const { owner, purpose } = target;
  const desired = [...new Set(target.namespaces)].sort();
  const missing = desired.filter((namespace) => !existing.has(namespace));
  if (missing.length) {
    throw new Error(
      `cannot enroll platform namespace ${missing.join(", ")} ${purpose}: namespace ${missing.join(", ")} does not exist. Its release did not create it; fix that release and rerun kore platform up`,
    );
  }
  for (const namespace of desired) {
    if (existing.get(namespace)?.labels?.[owner.label] !== owner.value) {
      await apply(repository, runner, namespace, true, owner);
    }
  }
  const wanted = new Set(desired);
  for (const [namespace, metadata] of existing) {
    if (
      !wanted.has(namespace) &&
      metadata.managedFields?.some(({ manager }) => manager === owner.manager)
    ) {
      await apply(repository, runner, namespace, false, owner);
    }
  }
}
