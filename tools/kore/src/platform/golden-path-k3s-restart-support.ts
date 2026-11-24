// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md
//
// The pure half of the in-place k3s restart drill (golden-path-k3s-restart.live.spec.ts):
// which context the restart may reach, what the pods and the node look like
// before and after, what the ready replicas did while the API server was not
// answering, and the record the drill prints. The live spec and its cluster steps
// do the reads and the restart; nothing here touches the cluster.

/** The fixed method of the drill. The sampler reads each second; the drill holds the probe after settling. */
export const k3sRestartDrill = {
  /** The systemd unit the drill restarts, in place. Its drain-free restart keeps the containers running. */
  unit: "k3s",
  /** The one context a restart may reach. The mutation names its context; no current context is used. */
  requiredContext: "kore-vps",
  /** How long the API server may take to answer again after the restart, the owner's 10-minute ceiling. */
  apiTimeoutSeconds: 600,
  /** How long the probe keeps sending after every Deployment is settled, so answers after the restart are counted. */
  holdSeconds: 30,
  sampleIntervalSeconds: 1,
} as const;

/** Refuses any context but the one the drill names, before any restart. Returns the reason, or undefined when the context is allowed. */
export function restartRefusalOf(kubeContext: string): string | undefined {
  if (kubeContext === k3sRestartDrill.requiredContext) {
    return undefined;
  }
  return `the k3s restart drill runs only on context ${k3sRestartDrill.requiredContext}, not "${kubeContext}"; set the drill's environment to vps so it restarts only the kore-vps node`;
}

export interface PodListDocument {
  items?: {
    metadata?: { name?: string; namespace?: string; uid?: string };
    status?: {
      phase?: string;
      containerStatuses?: { restartCount?: number }[];
    };
  }[];
}

/** A pod the drill checks, as the API server returns it. */
export interface PodState {
  namespace: string;
  name: string;
  uid: string;
  phase: string;
  /** The restart counts of its containers, summed. */
  restarts: number;
}

/** Reads each Pod in a list. Refuses one with no name, so no pod is checked unnamed. */
export function podsOf(document: PodListDocument): PodState[] {
  return (document.items ?? []).map((item) => {
    const name = item.metadata?.name;
    if (name === undefined || name === "") {
      throw new Error("a Pod document carries no metadata.name");
    }
    return {
      namespace: item.metadata?.namespace ?? "",
      name,
      uid: item.metadata?.uid ?? "",
      phase: item.status?.phase ?? "Unknown",
      restarts: (item.status?.containerStatuses ?? []).reduce(
        (total, status) => total + (status.restartCount ?? 0),
        0,
      ),
    };
  });
}

const podName = (pod: PodState): string => `${pod.namespace}/${pod.name}`;

/**
 * What the restart did to the Pods that were running before it. A Pod that is
 * replaced (its uid is gone) was evicted or drained; one with a new restart was
 * restarted, which the drill must not do; one that is no longer Running is not
 * still running. A Pod that had finished (a Job's) is not required to survive.
 */
export function podsKept(before: PodState[], after: PodState[]): string[] {
  const violations: string[] = [];
  for (const pod of before.filter(
    (candidate) => candidate.phase === "Running",
  )) {
    const now = after.find((candidate) => candidate.uid === pod.uid);
    if (now === undefined) {
      violations.push(
        `${podName(pod)} was replaced or evicted (uid ${pod.uid} is gone)`,
      );
      continue;
    }
    if (now.phase !== "Running") {
      violations.push(`${podName(pod)} is ${now.phase}, not Running`);
    }
    if (now.restarts > pod.restarts) {
      violations.push(
        `${podName(pod)} restarted its containers (restarts ${pod.restarts} -> ${now.restarts})`,
      );
    }
  }
  return violations;
}

export interface NodeListDocument {
  items?: {
    metadata?: { name?: string; uid?: string };
    spec?: { unschedulable?: boolean };
  }[];
}

/** A node the drill checks: its uid, and whether it is cordoned, as a drain leaves it. */
export interface NodeState {
  name: string;
  uid: string;
  unschedulable: boolean;
}

/** Reads each node in a list. Refuses one with no name. */
export function nodesOf(document: NodeListDocument): NodeState[] {
  return (document.items ?? []).map((item) => {
    const name = item.metadata?.name;
    if (name === undefined || name === "") {
      throw new Error("a Node document carries no metadata.name");
    }
    return {
      name,
      uid: item.metadata?.uid ?? "",
      unschedulable: item.spec?.unschedulable === true,
    };
  });
}

/** What the restart did to the node: it must be the same node and still schedulable. */
export function nodesKept(before: NodeState[], after: NodeState[]): string[] {
  const violations: string[] = [];
  for (const node of before) {
    const now = after.find((candidate) => candidate.name === node.name);
    if (now === undefined) {
      violations.push(`node ${node.name} is gone after the restart`);
      continue;
    }
    if (now.uid !== node.uid) {
      violations.push(
        `node ${node.name} was replaced (uid ${node.uid} -> ${now.uid})`,
      );
    }
    if (now.unschedulable) {
      violations.push(
        `node ${node.name} is unschedulable: it was cordoned, as a drain leaves it`,
      );
    }
  }
  return violations;
}

/**
 * One reading of the ready replicas, taken each interval while the restart runs.
 * An unanswered reading is one the API server did not return, so it has no
 * ready counts; it is recorded, not judged a dip.
 */
export interface ReadySample {
  seconds: number;
  answered: boolean;
  /** The ready replicas of each Deployment, by `<namespace>/<name>`, that the answered reading read. */
  ready: Readonly<Record<string, number>>;
}

export interface DeploymentFloor {
  deployment: string;
  minimumReady: number;
  /** The lowest answered count, or null when no answered reading read the Deployment. */
  lowestReady: number | null;
  answeredSamples: number;
}

export interface ReadyVerdict {
  deployments: DeploymentFloor[];
  unansweredSamples: number;
  /** The longest run of unanswered readings in a row, in samples. */
  longestUnansweredRun: number;
  /** The same run measured on the clock, from its first unanswered reading to the next answered one. */
  longestUnansweredSeconds: number;
  /** Each answered dip below a minimum, and each Deployment no answered reading ever read. */
  dips: string[];
}

/** One Deployment's answered readings: its floor, and each answered dip below its minimum, or its absence from every reading. */
function floorOf(
  samples: readonly ReadySample[],
  deployment: string,
  minimumReady: number,
): { floor: DeploymentFloor; dips: string[] } {
  const reads = samples.flatMap((sample) => {
    const ready = sample.answered ? sample.ready[deployment] : undefined;
    return ready === undefined ? [] : [{ seconds: sample.seconds, ready }];
  });
  const dips = reads
    .filter((read) => read.ready < minimumReady)
    .map(
      (read) =>
        `${deployment} had ${read.ready} ready replicas at ${read.seconds}s, below its minimum of ${minimumReady}`,
    );
  if (reads.length === 0) {
    dips.push(
      `${deployment} was never read by an answered sample, so its ready count is unknown`,
    );
  }
  return {
    floor: {
      deployment,
      minimumReady,
      lowestReady:
        reads.length === 0
          ? null
          : Math.min(...reads.map((read) => read.ready)),
      answeredSamples: reads.length,
    },
    dips,
  };
}

/** The unanswered readings: how many, and the longest run of them in samples and on the clock. */
function outageOf(samples: readonly ReadySample[]) {
  let unansweredSamples = 0;
  let longestUnansweredRun = 0;
  let longestUnansweredSeconds = 0;
  let run = 0;
  let runStart = 0;
  let last = 0;
  for (const sample of samples) {
    last = sample.seconds;
    if (sample.answered) {
      if (run > 0) {
        longestUnansweredSeconds = Math.max(
          longestUnansweredSeconds,
          sample.seconds - runStart,
        );
      }
      run = 0;
      continue;
    }
    if (run === 0) {
      runStart = sample.seconds;
    }
    unansweredSamples += 1;
    run += 1;
    longestUnansweredRun = Math.max(longestUnansweredRun, run);
  }
  if (run > 0) {
    // A run still open at the end lasts until one interval past its last reading.
    longestUnansweredSeconds = Math.max(
      longestUnansweredSeconds,
      last + k3sRestartDrill.sampleIntervalSeconds - runStart,
    );
  }
  return {
    unansweredSamples,
    longestUnansweredRun,
    longestUnansweredSeconds,
  };
}

/** Judges the ready replicas against each Deployment's minimum: every answered reading must hold it, and every Deployment must be read at least once. */
export function readyVerdict(
  samples: readonly ReadySample[],
  minimums: Readonly<Record<string, number>>,
): ReadyVerdict {
  const floors = Object.entries(minimums).map(([deployment, minimumReady]) =>
    floorOf(samples, deployment, minimumReady),
  );
  return {
    deployments: floors.map((entry) => entry.floor),
    ...outageOf(samples),
    dips: floors.flatMap((entry) => entry.dips),
  };
}

export interface RestartJudgement {
  /** The message of the probe's first failure, if one was seen. */
  probeFailure?: string | undefined;
  verdict: ReadyVerdict;
  /** What the pods check named as broken. */
  pods: string[];
  /** What the node check named as broken. */
  nodes: string[];
}

/** Every reason the restart drill fails: a failed request, a ready dip or an unread Deployment, a pod or node that did not hold. */
export function judgeRestart(judgement: RestartJudgement): string[] {
  return [
    ...(judgement.probeFailure === undefined
      ? []
      : [`a request failed during the k3s restart: ${judgement.probeFailure}`]),
    ...judgement.verdict.dips,
    ...judgement.pods,
    ...judgement.nodes,
  ];
}

export interface RestartRecordInput {
  requests: number;
  elapsedSeconds: number;
  loadAverage: number;
  gateway: { namespace: string; name: string; port: number };
  restart: { via: "ssh"; host: string; unit: string };
  verdict: ReadyVerdict;
  /** Seconds from the restart until the API server answered again. */
  apiReturnedSeconds: number;
  pods: { before: PodState[]; after: PodState[] };
  nodes: { before: NodeState[]; after: NodeState[] };
  host: { before: unknown; after: unknown };
}

/** The one JSON record a restart run prints: the method, the restart, what the API outage hid, the rollouts' floors, the pods and nodes kept, and the host beside them. */
export function k3sRestartRecordOf(input: RestartRecordInput) {
  const checked = input.pods.before.filter((pod) => pod.phase === "Running");
  const nodes = input.nodes.before.map((node) => node.name);
  const outage = input.verdict.unansweredSamples;
  return {
    method: {
      routeSet: "golden-path",
      probe: "shared Gateway, curl with no retries",
      restart: `${input.restart.via} ${input.restart.host} sudo -n systemctl restart ${input.restart.unit}`,
      sampleIntervalSeconds: k3sRestartDrill.sampleIntervalSeconds,
    },
    gateway: input.gateway,
    restart: {
      via: input.restart.via,
      host: input.restart.host,
      unit: input.restart.unit,
      inPlace: true,
      drained: false,
    },
    load: {
      requests: input.requests,
      failedRequests: 0,
      retries: 0,
      elapsedSeconds: input.elapsedSeconds,
    },
    apiOutage: {
      unansweredSamples: outage,
      longestUnansweredSeconds: input.verdict.longestUnansweredSeconds,
      returnedAfterSeconds: input.apiReturnedSeconds,
    },
    deployments: input.verdict.deployments,
    pods: { checked: checked.map((pod) => `${pod.namespace}/${pod.name}`) },
    nodes: { checked: nodes },
    // Shadow until the gateway's own error metric is scraped: recorded, not gated.
    gatewayErrorRatio: {
      value: 0,
      gated: false,
      source: "probe",
      note: "shadow until the gateway's error metric is scraped",
    },
    loadAverage: { start: input.loadAverage },
    host: input.host,
    evidence: `zero failed requests with no retries over ${input.requests} requests through the shared Gateway, across an in-place restart of ${input.restart.unit} on ${input.restart.host}; ${outage} unanswered sample(s) (longest run ${input.verdict.longestUnansweredRun} sample(s)) while the API server did not answer; lowest ready replicas against their minimum: ${input.verdict.deployments.map((floor) => `${floor.deployment} ${floor.lowestReady ?? "unread"}/${floor.minimumReady}`).join(", ") || "none"}; ${checked.length} running pods and ${nodes.length} node(s) checked after the restart`,
  };
}
