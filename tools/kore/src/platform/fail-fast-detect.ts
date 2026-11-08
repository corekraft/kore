import { CommandError, type Runner } from "../runtime/index.js";
import { NOT_YET_THERE } from "./readiness-poll.js";

const INSTANCE_LABEL = "app.kubernetes.io/instance";
const CRASH_RESTARTS = 2;
const PERSISTING = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
]);

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
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}
interface EventItem {
  reason?: string;
  message?: string;
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
    const config = reason === "CreateContainerConfigError";
    return {
      ...base,
      state: reason,
      detail: waiting.message ?? "",
      hint: config
        ? "Check the referenced Secrets, ConfigMaps, and env keys exist."
        : "Check the image reference, its digest, and registry access.",
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
  const result = pods.flatMap(podFindings);
  if (unscheduled.length > 0) {
    const events =
      (await kubectlJson<EventItem>(runner, base, [
        "get",
        "events",
        "--field-selector",
        "reason=FailedScheduling",
        "--output",
        "json",
      ])) ?? [];
    for (const pod of unscheduled) {
      const event = events.find(
        ({ involvedObject }) =>
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
