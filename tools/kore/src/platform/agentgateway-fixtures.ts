import {
  loadRepository,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { desiredFingerprint } from "./fingerprint.js";

export const agentgateway = /agentgateway/;

/** The real catalog entries agentgateway depends on, plus itself. */
export const involved = [
  "kore-gateway-api",
  "cert-manager",
  "agentgateway-crds",
  "agentgateway",
];

/**
 * The local overlay with the ingress flag set. The catalog is cut to
 * agentgateway and its prerequisites, which keep their real dependency edges;
 * only the prerequisites' readiness is simplified, since their own proofs are
 * not under test here.
 */
export async function local(on: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  const sibling = {
    ...base.catalog.components.find((c) => c.kind === "helm")!,
    name: "sibling",
    namespace: "sibling-ns",
    phase: "core" as const,
    dependencies: [],
    ownsCRDs: [],
    readiness: ["configmap/ready"],
  };
  const components = base.catalog.components
    .filter((c) => involved.includes(c.name))
    .map((c) => {
      const kept = c.dependencies.filter((d) => involved.includes(d));
      const prerequisite = !c.name.startsWith("agentgateway");
      return {
        ...c,
        dependencies: kept,
        ...(prerequisite
          ? { readiness: ["configmap/ready"], ownsCRDs: [] }
          : {}),
      };
    });
  return {
    ...base,
    catalog: { ...base.catalog, components: [sibling, ...components] },
    environment: {
      ...base.environment,
      provider: "managed",
      features: { ...base.environment.features, "ingress-agentgateway": on },
    },
  };
}

export function component(repository: Repository, name: string): Component {
  return repository.catalog.components.find((c) => c.name === name)!;
}

/**
 * A cluster whose releases are all absent (`converged` false) or all deployed
 * from the current desired state (`converged` true). Gated-off releases are
 * never installed, so Helm answers not found for them in both cases.
 */
export function cluster(repository: Repository, converged: boolean) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      if (command !== "helm") {
        return { stdout: kubectlAnswer(args.join(" ")), stderr: "", code: 0 };
      }
      const name = args[1]!;
      const gatedOff =
        agentgateway.test(name) &&
        repository.environment.features?.["ingress-agentgateway"] !== true;
      if (args[0] === "status" || args[0] === "history") {
        if (gatedOff || !converged) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        const found = repository.catalog.components.find(
          (c) => c.name === name,
        );
        return {
          stdout:
            args[0] === "status"
              ? JSON.stringify({ info: { status: "deployed" } })
              : JSON.stringify([
                  {
                    status: "deployed",
                    description: found
                      ? desiredFingerprint(repository, found)
                      : "",
                  },
                ]),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

/** What the readiness probes read back from a healthy cluster. */
export function kubectlAnswer(joined: string): string {
  if (joined.includes("availableReplicas")) {
    return "available";
  }
  return joined.includes("tls.crt") ? "ready" : "";
}

export const upgrades = (calls: string[]) =>
  calls
    .filter((c) => c.startsWith("helm upgrade"))
    .map((c) => /upgrade --install (\S+)/.exec(c)![1]!);
