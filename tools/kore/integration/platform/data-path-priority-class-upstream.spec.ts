import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { documents, renderComponent } from "./data-path-qos-support.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Opt-in: it pulls the pinned policy-controller chart, and fast tests run offline (AGENTS.md).
// Run with `npm run test:upstream-charts` when bumping policy-controller.
// Issue 1531: with data-path-priority-class on, the webhook and the leases-cleanup Job name the kore-owned class;
// off, the chart renders no priority class, as it does today.

const run = test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1");

// Each render pulls the pinned chart over the network, so the tests get more than the default 5 s.
const NETWORK_TIMEOUT_MS = 120_000;

const flag = "data-path-priority-class";
const className = "kore-platform-critical";

function withPriority(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [flag]: on },
    },
  };
}

/** Every non-empty priorityClassName a render names, at any depth of the documents. */
function priorityClassNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(priorityClassNames);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      if (key !== "priorityClassName") {
        return priorityClassNames(child);
      }
      // The chart renders `priorityClassName:` empty when no class is set, which is no name.
      return typeof child === "string" && child !== "" ? [child] : [];
    });
  }
  return [];
}

run(
  "flag off: the policy controller names no kore priority class",
  async () => {
    const repository = withPriority(await loadRepository("local"), false);
    const names = priorityClassNames(
      documents(renderComponent(repository, "policy-controller")),
    );
    if (names.length > 0) {
      throw new Error(`names ${names.join(", ")} with the flag off`);
    }
  },
  NETWORK_TIMEOUT_MS,
);

run(
  "flag on: the webhook and the leases-cleanup Job name the kore-owned class",
  async () => {
    const repository = withPriority(await loadRepository("local"), true);
    const names = priorityClassNames(
      documents(renderComponent(repository, "policy-controller")),
    );
    if (names.length < 2) {
      throw new Error(
        `expected the webhook and the cleanup Job, found ${names.length}`,
      );
    }
    for (const name of names) {
      if (name !== className) {
        throw new Error(`names ${name}, not ${className}`);
      }
    }
  },
  NETWORK_TIMEOUT_MS,
);
