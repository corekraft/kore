// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { expect, test, vi } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import type { Run } from "./security-support.js";
import {
  rollDeployment,
  rollsDeployment,
  type RolloutTarget,
} from "./token-rollout.js";

const rolledKey = "platform.kore.dev/rolled-document-sha256";
const checksum = "the-new-document";
const previousChecksum = "the-previous-document";

const target: RolloutTarget = {
  context: "kore-vps",
  name: "external-dns",
  namespace: "kore-external-dns",
  secret: "cloudflare-token",
  deployment: "external-dns",
  checksum,
};

/**
 * The live cluster the kubectl calls read and change: the token Secret's
 * annotations, absent until the first apply, and whether the Deployment exists.
 * A restart that fails changes nothing; a new pod that never becomes ready fails
 * the rollout status wait.
 */
interface Cluster {
  secret?: Record<string, string>;
  deployment: boolean;
  restartFails: boolean;
  readyFails: boolean;
}

/** A cluster whose token Secret last rolled at `rolled`. */
const rolledAt = (rolled: string, deployment = true): Cluster => ({
  secret: { [rolledKey]: rolled },
  deployment,
  restartFails: false,
  readyFails: false,
});

type Calls = ReturnType<typeof vi.fn<Run>>;

/** What a kubectl read returns: the Secret's annotations or the Deployment's name, or nothing when absent. */
function read(args: readonly string[], cluster: Cluster): string {
  if (args.includes("secret")) {
    return cluster.secret === undefined
      ? ""
      : JSON.stringify({ metadata: { annotations: cluster.secret } });
  }
  return cluster.deployment ? "deployment.apps/external-dns\n" : "";
}

/**
 * A runner that answers kubectl the way the cluster would: a record sets the
 * rolled annotation, and a restart or its rollout status wait fails when the
 * cluster says so.
 */
function runnerWith(cluster: Cluster) {
  const run = vi.fn<Run>(async (_command, args): Promise<RunResult> => {
    if (args.includes("annotate")) {
      const assignment = args.find((arg) => arg.startsWith(`${rolledKey}=`));
      cluster.secret = {
        ...cluster.secret,
        [rolledKey]: assignment?.slice(rolledKey.length + 1) ?? "",
      };
    } else if (args.includes("restart") && cluster.restartFails) {
      throw new Error("the connection to the server was refused");
    } else if (args.includes("status") && cluster.readyFails) {
      throw new Error(
        'error: deployment "external-dns" exceeded its progress deadline',
      );
    }
    const stdout = args.includes("get") ? read(args, cluster) : "";
    return { stdout, stderr: "", code: 0 };
  });
  const runner: Runner = { run };
  return { runner, run };
}

/** Each kubectl call as read, restart, wait, or record, in call order. */
function steps(run: Calls) {
  return run.mock.calls.map(([, args]) => {
    if (args.includes("restart")) {
      return "restart";
    }
    if (args.includes("status")) {
      return "wait";
    }
    return args.includes("annotate") ? "record" : "read";
  });
}

/** The arguments of each call that is the named step, in call order. */
function callsOf(run: Calls, step: string) {
  const kinds = steps(run);
  return run.mock.calls.flatMap(([, args], index) =>
    kinds[index] === step ? [args] : [],
  );
}

const inContext = ["--context", "kore-vps", "--namespace", "kore-external-dns"];
const restartArgs = [
  ...inContext,
  "rollout",
  "restart",
  "deployment/external-dns",
];
const waitArgs = [
  ...inContext,
  "rollout",
  "status",
  "deployment/external-dns",
  "--timeout=5m",
];
const recordArgs = [
  ...inContext,
  "annotate",
  "secret",
  "cloudflare-token",
  `${rolledKey}=${checksum}`,
  "--overwrite",
];
const logsCommand = `kubectl ${inContext.join(" ")} logs deployment/external-dns`;

/** One run of the caller: decide before the Secret applies, then roll if needed. */
async function rerun(runner: Runner): Promise<void> {
  if (await rollsDeployment(target, runner)) {
    await rollDeployment(target, runner);
  }
}

test("a Deployment that rolled for an earlier document rolls for a new one", async () => {
  const { runner } = runnerWith(rolledAt(previousChecksum));

  expect(await rollsDeployment(target, runner)).toBe(true);
});

test("a Deployment that already rolled for this document does not roll again, and its Deployment is not even read", async () => {
  const { runner, run } = runnerWith(rolledAt(checksum));

  expect(await rollsDeployment(target, runner)).toBe(false);
  expect(steps(run)).toEqual(["read"]);
});

test("a first apply, with no Secret and no Deployment yet, rolls nothing", async () => {
  const { runner } = runnerWith({
    deployment: false,
    restartFails: false,
    readyFails: false,
  });

  expect(await rollsDeployment(target, runner)).toBe(false);
});

test("a new document rolls nothing while its Deployment does not exist", async () => {
  const { runner } = runnerWith(rolledAt(previousChecksum, false));

  expect(await rollsDeployment(target, runner)).toBe(false);
});

test("rolling restarts the Deployment, waits for its new pod within the bound, then records the rolled checksum on the token Secret", async () => {
  const cluster = rolledAt(previousChecksum);
  const { runner, run } = runnerWith(cluster);

  await rollDeployment(target, runner);

  expect(steps(run)).toEqual(["restart", "wait", "record"]);
  expect(callsOf(run, "restart")).toEqual([restartArgs]);
  expect(callsOf(run, "wait")).toEqual([waitArgs]);
  expect(callsOf(run, "record")).toEqual([recordArgs]);
  expect(cluster.secret?.[rolledKey]).toEqual(checksum);
});

test("every kubectl call names the configured context, never the current one, and runs through the runner", async () => {
  const { runner, run } = runnerWith(rolledAt(previousChecksum));

  await rerun(runner);

  expect(run.mock.calls).toHaveLength(5);
  for (const [command, args] of run.mock.calls) {
    expect(command).toEqual("kubectl");
    expect(args.slice(0, 4)).toEqual(inContext);
  }
});

test("a failed restart names the rollout command to run by hand, waits for nothing, and records nothing", async () => {
  const cluster = { ...rolledAt(previousChecksum), restartFails: true };
  const { runner, run } = runnerWith(cluster);

  await expect(rollDeployment(target, runner)).rejects.toThrow(
    `kubectl ${restartArgs.join(" ")}`,
  );
  expect(steps(run)).toEqual(["restart"]);
  expect(cluster.secret?.[rolledKey]).toEqual(previousChecksum);
});

test("a new pod that does not become ready within the bound fails, naming the cause and the kubectl logs command, and records nothing", async () => {
  const cluster = { ...rolledAt(previousChecksum), readyFails: true };
  const { runner, run } = runnerWith(cluster);
  const rolling = rollDeployment(target, runner);

  await expect(rolling).rejects.toThrow(
    "its new pod did not become ready within 5m: error: deployment",
  );
  await expect(rolling).rejects.toThrow(`Read why with: ${logsCommand}`);
  expect(steps(run)).toEqual(["restart", "wait"]);
  expect(cluster.secret?.[rolledKey]).toEqual(previousChecksum);
});

test("a rerun after a failed restart restarts the Deployment once, waits, and records the rolled checksum", async () => {
  const cluster = { ...rolledAt(previousChecksum), restartFails: true };
  const { runner, run } = runnerWith(cluster);

  await expect(rerun(runner)).rejects.toThrow(
    "restarting its Deployment failed",
  );
  run.mockClear();
  cluster.restartFails = false;
  await rerun(runner);

  expect(steps(run)).toEqual(["read", "read", "restart", "wait", "record"]);
  expect(cluster.secret?.[rolledKey]).toEqual(checksum);
});

test("a rerun after the new pod did not become ready restarts the Deployment again, waits, and records the rolled checksum once ready", async () => {
  const cluster = { ...rolledAt(previousChecksum), readyFails: true };
  const { runner, run } = runnerWith(cluster);

  await expect(rerun(runner)).rejects.toThrow("did not become ready");
  run.mockClear();
  cluster.readyFails = false;
  await rerun(runner);

  expect(steps(run)).toEqual(["read", "read", "restart", "wait", "record"]);
  expect(callsOf(run, "wait")).toEqual([waitArgs]);
  expect(cluster.secret?.[rolledKey]).toEqual(checksum);
});

test("a rerun after a successful roll restarts nothing and records nothing new", async () => {
  const { runner, run } = runnerWith(rolledAt(previousChecksum));

  await rerun(runner);
  run.mockClear();
  await rerun(runner);

  expect(steps(run)).toEqual(["read"]);
});

test("a record that fails after the pod is ready says a rerun restarts once more, then records", async () => {
  const { runner, run } = runnerWith(rolledAt(previousChecksum));
  run.mockImplementation(async (_command, args) => {
    if (args.includes("annotate")) {
      throw new Error("the server is currently unable to handle the request");
    }
    return { stdout: "", stderr: "", code: 0 };
  });

  await expect(rollDeployment(target, runner)).rejects.toThrow(
    "rolled and is ready, but recording the rolled checksum on its token Secret failed",
  );
});
