import { gatewayClassName } from "./features.js";
import { platformPlan } from "./platform-domain.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

/** The kore-config-delivery chart's values (infra/charts/platform-config-delivery). */
export interface ChartDeliveryValues {
  charts: Record<string, { chart: string; digest: string }>;
  namespaces: Record<string, string>;
  /** The GatewayClass kore-platform-config needs, which only kore derives. */
  gatewayClassName: string;
  /**
   * The environment's platform domain, which the delivered kore-platform-config
   * and kore-local-tls take as `gateway.hostname`: their charts hold no default.
   */
  platformDomain: string;
  /**
   * Each release's environment values-file text, in the order Helm takes them,
   * so the Argo CD Application renders the chart with the values the Helm path
   * gives it. Composed beside the lock, since reading a file is not pure.
   */
  releaseValues?: Record<string, string[]>;
}

/** The release the delivery chart never carries: kore keeps the image policy (ADR 0028). */
const imagePolicy = "kore-image-policy";
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const chartPattern = /^[^@:\s/]+(:[0-9]+)?(\/[^@:\s/]+)+$/;
const prefix = "platform chart lock:";

type Entry = { chart?: unknown; digest?: unknown };

function entriesOf(lock: unknown): Record<string, Entry> | undefined {
  const value = lock as { version?: unknown; entries?: unknown } | null;
  return value !== null &&
    typeof value === "object" &&
    value.version === 1 &&
    value.entries !== null &&
    typeof value.entries === "object"
    ? (value.entries as Record<string, Entry>)
    : undefined;
}

function entryErrors(name: string, entry: Entry | undefined): string[] {
  if (entry === undefined) {
    return [
      `${prefix} no entry for release ${name}; pass the platform-charts.lock.json of the release that published it`,
    ];
  }
  return [
    ...(typeof entry.digest === "string" && digestPattern.test(entry.digest)
      ? []
      : [
          `${prefix} ${name} digest must be sha256:<64 hex>, never a version or tag; republish the release`,
        ]),
    ...(typeof entry.chart === "string" && chartPattern.test(entry.chart)
      ? []
      : [
          `${prefix} ${name} chart must be an OCI path without a scheme, such as <registry>/<path>/${name}; republish the release`,
        ]),
  ];
}

function handedOver(repository: Repository) {
  return repository.catalog.components.filter((c) => c.owner === "argocd");
}

/**
 * Every problem that stops the delivery values from being composed, found from
 * the lock and the catalog alone so it is reported before a cluster is touched.
 */
export function chartDeliveryErrors(
  repository: Repository,
  lock: unknown,
): string[] {
  const components = handedOver(repository);
  if (components.length === 0) {
    return [
      "no catalog release has owner argocd, so kore-config-delivery has nothing to deliver; set owner: argocd on the releases to hand over",
    ];
  }
  const entries = entriesOf(lock);
  if (entries === undefined) {
    return [
      `${prefix} expected {version: 1, entries: {<release>: {chart, digest}}}; pass the platform-charts.lock.json attached to the release`,
    ];
  }
  return [
    ...(imagePolicy in entries
      ? [
          `${prefix} entry ${imagePolicy} must not exist; kore keeps the image policy (ADR 0028), so publish the release without it`,
        ]
      : []),
    ...components.flatMap((c) => entryErrors(c.name, entries[c.name])),
  ];
}

/** The chart values, or an error naming every problem and its fix. */
export function chartDeliveryValues(
  repository: Repository,
  lock: unknown,
): ChartDeliveryValues {
  const errors = chartDeliveryErrors(repository, lock);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const entries = entriesOf(lock)!;
  const components = handedOver(repository);
  return {
    charts: Object.fromEntries(
      components.map((c) => [
        c.name,
        {
          chart: entries[c.name]!.chart as string,
          digest: entries[c.name]!.digest as string,
        },
      ]),
    ),
    namespaces: Object.fromEntries(
      components.map((c) => [c.name, c.namespace]),
    ),
    gatewayClassName: gatewayClassName(repository.environment),
    platformDomain: platformPlan(repository.environment).domain,
  };
}

/** Each distinct registry path that holds a chart, as Argo CD addresses a repository. */
export function chartRepositoryUrls(values: ChartDeliveryValues): string[] {
  return [
    ...new Set(
      Object.values(values.charts).map(({ chart }) =>
        chart.slice(0, chart.lastIndexOf("/")),
      ),
    ),
  ].sort();
}
