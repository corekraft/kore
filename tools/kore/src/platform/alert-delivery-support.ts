// Shared fakes for the alert proof's unit specs: a stateful cluster and an inbox reader, with no process or timer.
import type {
  ClusterApi,
  DeploymentState,
  RuleState,
} from "./alert-delivery-api.live.js";
import { proveAlertDelivery } from "./alert-delivery.live.js";
import type {
  DeliveryDeps,
  DeliveryOptions,
  DeliveryReport,
  InboxCheck,
} from "./alert-delivery-types.live.js";

export const service = "golden-path-example";
export const namespace = "golden-path-example--local";

export const options: DeliveryOptions = {
  service,
  namespace,
  contactPoint: "kore-platform-email",
  alertSeconds: 900,
  deliverySeconds: 300,
  pollSeconds: 15,
};

export const proofEvents = [
  "annotate golden-path-example--local/golden-path-example=2",
  "scale golden-path-example--local/golden-path-example=0",
  "scale golden-path-example--local/golden-path-example=2",
  "forget golden-path-example--local/golden-path-example",
];

export const proofCalls = [
  "kubectl get deployments",
  "Prometheus GET /api/v1/rules",
  "kubectl annotate deployment",
  "kubectl scale deployment",
  "Grafana GET /api/alertmanager/grafana/api/v2/alerts",
  "Grafana GET /api/v1/provisioning/contact-points",
  "inbox API read",
];

export interface Plan {
  rules?: RuleState[];
  receivers?: (string[] | undefined)[];
  receiversError?: string;
  contactPoints?: string[];
  deployments?: Record<string, DeploymentState>;
  refuseRestore?: boolean;
}

// The last value repeats once the list runs out, so a poll that never changes is a poll that never ends.
export function sequence<T>(values: readonly T[]): () => T {
  const entries = values.map((value) => ({ value }));
  let index = 0;
  return () => {
    const entry = entries[Math.min(index, entries.length - 1)];
    if (entry === undefined) {
      throw new Error("the fake needs at least one answer");
    }
    index += 1;
    return entry.value;
  };
}

// A stateful cluster: scale, record and forget change what the next read returns, and every write is logged.
export function fakeApi(plan: Plan, events: string[]): ClusterApi {
  const rule = sequence<RuleState>(plan.rules ?? ["firing"]);
  const receivers = sequence<string[] | undefined>(
    plan.receivers ?? [["kore-platform-email"]],
  );
  const deployments: Record<string, DeploymentState> = {
    ...(plan.deployments ?? { [service]: { replicas: 2 } }),
  };
  const stateOf = (name: string): DeploymentState => {
    const state = deployments[name];
    if (state === undefined) {
      throw new Error("no Deployment " + name);
    }
    return state;
  };
  return {
    ruleState: async () => rule(),
    alertReceivers: async () => {
      if (plan.receiversError !== undefined) {
        throw new Error(plan.receiversError);
      }
      return receivers();
    },
    contactPointNames: async () =>
      plan.contactPoints ?? ["kore-platform-email"],
    deployments: async () => ({ ...deployments }),
    record: async (ns, name, replicas) => {
      events.push("annotate " + ns + "/" + name + "=" + String(replicas));
      deployments[name] = { ...stateOf(name), recorded: replicas };
    },
    forget: async (ns, name) => {
      events.push("forget " + ns + "/" + name);
      deployments[name] = { replicas: stateOf(name).replicas };
    },
    scale: async (ns, name, replicas) => {
      events.push("scale " + ns + "/" + name + "=" + String(replicas));
      if (replicas > 0 && plan.refuseRestore === true) {
        throw new Error("kubectl refused");
      }
      deployments[name] = { ...stateOf(name), replicas };
    },
  };
}

export function inboxReading(
  arrived: boolean[],
  since: number[] = [],
): InboxCheck {
  const next = sequence(arrived);
  return {
    kind: "read",
    reader: {
      arrivedSince: async (time: number) => {
        since.push(time);
        return next();
      },
    },
  };
}

export function inboxFailing(message: string): InboxCheck {
  return {
    kind: "read",
    reader: {
      arrivedSince: async () => {
        throw new Error(message);
      },
    },
  };
}

export async function messageOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
}

function depsFor(
  plan: Plan,
  inbox: InboxCheck,
  events: string[],
): DeliveryDeps {
  return {
    api: fakeApi(plan, events),
    inbox,
    now: () => 1_000_000,
    sleep: async () => {},
  };
}

/** Runs the proof on the fake cluster: its report, and every write it made in order. */
export async function prove(
  plan: Plan,
  inbox: InboxCheck = inboxReading([true]),
): Promise<{ report: DeliveryReport; events: string[] }> {
  const events: string[] = [];
  const report = await proveAlertDelivery(
    depsFor(plan, inbox, events),
    options,
  );
  return { report, events };
}

/** Runs the proof on the fake cluster: the message of the error it throws, and the writes made before it. */
export async function proveFailing(
  plan: Plan,
  inbox: InboxCheck = inboxReading([true]),
): Promise<{ message: string; events: string[] }> {
  const events: string[] = [];
  const message = await messageOf(
    proveAlertDelivery(depsFor(plan, inbox, events), options),
  );
  return { message, events };
}
