import { CommandError, type Runner } from "../runtime/index.js";
import { NOT_YET_THERE } from "./readiness-poll.js";

const INSTANCE_LABEL = "app.kubernetes.io/instance";
const CRASH_RESTARTS = 2;
const PERSISTING = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
]);
/** Waiting reasons of a pod whose containers have not started yet. */
const CREATING = new Set(["ContainerCreating", "PodInitializing"]);
/** Events that say the kubelet cannot create the pod's sandbox or containers. */
const CREATE_FAILURES = new Set([
  "FailedCreatePodSandBox",
  "FailedCreatePodContainer",
  "Failed",
]);
const REPEATED_EVENTS = 3;

const PERSISTING_HINTS: Record<string, string> = {
  CreateContainerConfigError:
    "Check the referenced Secrets, ConfigMaps, and env keys exist.",
  CreateContainerError:
    "Check the container's command, securityContext, and volume mounts, and the image's entrypoint.",
  RunContainerError:
    "Check the container's command and entrypoint, securityContext, runtime class, and volume mounts.",
  ErrImagePull: "Check the image reference, its digest, and registry access.",
};
const SANDBOX_HINT =
  "Check resources.limits, runtime class, CNI, or volume mounts (a too-low memory limit OOM-kills the sandbox).";

interface ContainerStatus {
  name: string;
  restartCount?: number;
  state?: { waiting?: { reason?: string; message?: string } };
  lastState?: {
    terminated?: { reason?: string; exitCode?: number; message?: string };
  };
}
interface PodItem {
  metadata: { name: string; labels?: Record<string, string> };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}
interface EventItem {
  reason?: string;
  message?: string;
  count?: number;
  involvedObject?: { kind?: string; name?: string };
}

/** A fatal state found in one pod; `key` identifies it across looks. */
export interface Finding {
  key: string;
  pod: string;
  subject: string;
  state: string;
  detail: string;
  /** Container whose previous logs explain the state, if any. */
  logs?: { container: string };
  hint: string;
  /** Needs to persist past the grace period before it is fatal. */
  persists: boolean;
  /** Full description of where the pod is stuck, replacing `pod <p> <subject>`. */
  where?: string;
  /** Needs 1.5x the grace period: the evidence is thinner (a lone event). */
  slow?: boolean;
}

function terminatedSummary(status: ContainerStatus): string {
  const terminated = status.lastState?.terminated;
  if (!terminated) {
    return "";
  }
  const parts = [terminated.reason, `exit ${terminated.exitCode ?? "?"}`];
  return `last exit: ${parts.filter(Boolean).join(", ")}${terminated.message ? ` ${JSON.stringify(terminated.message)}` : ""}`;
}

function containerFinding(
  podName: string,
  status: ContainerStatus,
  init: boolean,
): Finding | undefined {
  const waiting = status.state?.waiting;
  const reason = waiting?.reason;
  if (!reason) {
    return undefined;
  }
  const restarts = status.restartCount ?? 0;
  const subject = `${init ? "init container" : "container"} ${status.name}`;
  const base = {
    pod: podName,
    subject,
    key: `${podName}/${status.name}/${reason}`,
  };
  if (reason === "CrashLoopBackOff" && restarts >= CRASH_RESTARTS) {
    return {
      ...base,
      logs: { container: status.name },
      state: `CrashLoopBackOff (${restarts} restarts)`,
      detail: terminatedSummary(status),
      hint: "Check the container's ports and env, then its args and mounts.",
      persists: false,
    };
  }
  if (PERSISTING.has(reason)) {
    return {
      ...base,
      state: reason,
      detail: waiting.message ?? "",
      hint: PERSISTING_HINTS[reason] ?? PERSISTING_HINTS["ErrImagePull"]!,
      persists: true,
    };
  }
  return undefined;
}

function podFindings(pod: PodItem): Finding[] {
  const name = pod.metadata.name;
  const found: (Finding | undefined)[] = [
    ...(pod.status?.initContainerStatuses ?? []).map((status) =>
      containerFinding(name, status, true),
    ),
    ...(pod.status?.containerStatuses ?? []).map((status) =>
      containerFinding(name, status, false),
    ),
  ];
  return found.flatMap((finding) => (finding ? [finding] : []));
}

/** The state a scheduled pod is stuck in before its containers run, if any. */
function creatingState(pod: PodItem): string | undefined {
  const statuses = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  for (const status of statuses) {
    const reason = status.state?.waiting?.reason;
    if (reason && CREATING.has(reason)) {
      return reason;
    }
  }
  return pod.status?.phase === "Pending" ? "Pending" : undefined;
}

/** The pod's most telling create-failure event: the one repeated most. */
function createFailure(
  pod: PodItem,
  events: EventItem[],
): EventItem | undefined {
  const own = events.filter(
    ({ involvedObject, reason }) =>
      involvedObject?.kind === "Pod" &&
      involvedObject.name === pod.metadata.name &&
      reason !== undefined &&
      CREATE_FAILURES.has(reason),
  );
  return own.reduce<EventItem | undefined>(
    (best, event) =>
      !best || (event.count ?? 1) > (best.count ?? 1) ? event : best,
    undefined,
  );
}

function createFinding(pod: PodItem, stuck: string, event: EventItem): Finding {
  const count = event.count ?? 1;
  const name = pod.metadata.name;
  return {
    key: `${name}/${event.reason}`,
    pod: name,
    subject: "creating",
    where: `pod ${name} is stuck in ${stuck}`,
    state: `${event.reason}${count > 1 ? ` (x${count})` : ""}`,
    detail: JSON.stringify(event.message ?? ""),
    hint: SANDBOX_HINT,
    persists: true,
    slow: count < REPEATED_EVENTS,
  };
}

/** The release's pods; unlabelled pods count because not every chart sets the label. */
function belongsToRelease(pod: PodItem, release: string): boolean {
  const instance = pod.metadata.labels?.[INSTANCE_LABEL];
  return instance === undefined || instance === release;
}

async function kubectlJson<T>(
  runner: Runner,
  base: string[],
  args: string[],
): Promise<T[] | undefined> {
  try {
    const { stdout } = await runner.run("kubectl", [...base, ...args], {
      capture: true,
    });
    return (JSON.parse(stdout) as { items: T[] }).items;
  } catch (error) {
    // Namespace not created yet, or a passing API error: look again next time.
    if (error instanceof CommandError || NOT_YET_THERE.test(String(error))) {
      return undefined;
    }
    throw error;
  }
}

export async function findings(
  runner: Runner,
  base: string[],
  release: string,
): Promise<Finding[]> {
  const pods = (
    (await kubectlJson<PodItem>(runner, base, [
      "get",
      "pods",
      "--output",
      "json",
    ])) ?? []
  ).filter((pod) => belongsToRelease(pod, release));
  const unscheduled = pods.filter(
    (pod) => !pod.spec?.nodeName && podFindings(pod).length === 0,
  );
  const creating = pods.filter(
    (pod) =>
      pod.spec?.nodeName &&
      podFindings(pod).length === 0 &&
      creatingState(pod) !== undefined,
  );
  const result = pods.flatMap(podFindings);
  if (unscheduled.length + creating.length > 0) {
    const events =
      (await kubectlJson<EventItem>(runner, base, [
        "get",
        "events",
        "--output",
        "json",
      ])) ?? [];
    for (const pod of creating) {
      const event = createFailure(pod, events);
      if (event) {
        result.push(createFinding(pod, creatingState(pod)!, event));
      }
    }
    for (const pod of unscheduled) {
      const event = events.find(
        ({ involvedObject, reason }) =>
          reason === "FailedScheduling" &&
          involvedObject?.kind === "Pod" &&
          involvedObject.name === pod.metadata.name,
      );
      if (event) {
        result.push({
          key: `${pod.metadata.name}/FailedScheduling`,
          pod: pod.metadata.name,
          subject: "scheduling",
          state: "FailedScheduling",
          detail: event.message ?? "",
          hint: "Check the pod's resource requests, affinity, taints, and node capacity.",
          persists: true,
        });
      }
    }
  }
  return result;
}
