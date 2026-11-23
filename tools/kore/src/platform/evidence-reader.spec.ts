// Docs: docs/decisions/0143-the-controller-reaches-a-managed-registry-through-a-forward-over-the-tailnet.md
// (the registry forward pattern); issue #1520 under spec #1510.
import { expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import {
  CommandError,
  type Runner,
  type RunOptions,
  type RunResult,
} from "../runtime/index.js";
import { readEvidence, type EvidenceWindow } from "./evidence-reader.js";

// The runner is the only seam: every kubectl and curl call goes through it, so
// these units start no process, open no socket and wait on no timer (ADR 0098).
const repository = {
  root: "/repo",
  environment: { name: "vps", provider: "managed", kubeContext: "kore-vps" },
} as unknown as Repository;

const window: EvidenceWindow = {
  start: new Date(1_700_000_000_000),
  end: new Date(1_700_000_120_000),
  stepSeconds: 60,
};

const BUILDINFO = '{"status":"success","data":{"version":"3.16.0"}}';

interface Store {
  /** What answers on the local port before a forward starts. Absent means nothing listens. */
  before?: string | Error;
  /** kubectl's failure, when it exits before the read is done. */
  exit?: Error;
  /** The forward's answer at buildinfo: a body or a failure. */
  buildinfo?: string | Error;
  /** The forward takes the connection and never answers, until it is stopped. */
  silentBuildinfo?: boolean;
  /** The answer to a range query for one series name. */
  query?: (name: string) => string | Error;
}

interface Call {
  command: string;
  args: readonly string[];
  options: RunOptions | undefined;
}

/** A process that runs until it is stopped, as a port-forward does. */
function untilStopped(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new Error("the process was stopped")),
    );
  });
}

/** curl's exit 7: nothing listens on the port. */
function refused(args: readonly string[]): CommandError {
  return new CommandError("curl", args, {
    stdout: "",
    stderr:
      "curl: (7) Failed to connect to 127.0.0.1 port 30090: Connection refused",
    code: 7,
  });
}

function answer(stdout: string): RunResult {
  return { stdout, stderr: "", code: 0 };
}

function matrix(result: unknown[]): string {
  return JSON.stringify({
    status: "success",
    data: { resultType: "matrix", result },
  });
}

function queryName(args: readonly string[]): string {
  const pair = args.find((arg) => arg.startsWith("query="));
  return pair?.slice("query=".length) ?? "";
}

/** A runner standing in for kubectl and curl, recording every call it gets. */
function metricsStore(store: Store = {}): {
  runner: Runner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run = vi.fn<Runner["run"]>(
    async (command, args, options): Promise<RunResult> => {
      calls.push({ command, args, options });
      if (command === "kubectl") {
        if (store.exit !== undefined) {
          throw store.exit;
        }
        return untilStopped(options?.signal);
      }
      if (args.includes("--get")) {
        const reply = store.query?.(queryName(args)) ?? matrix([]);
        if (reply instanceof Error) {
          throw reply;
        }
        return answer(reply);
      }
      if (!args.includes("--retry")) {
        if (store.before === undefined) {
          throw refused(args);
        }
        if (store.before instanceof Error) {
          throw store.before;
        }
        return answer(store.before);
      }
      if (store.silentBuildinfo === true) {
        return untilStopped(options?.signal);
      }
      if (store.buildinfo instanceof Error) {
        throw store.buildinfo;
      }
      return answer(store.buildinfo ?? BUILDINFO);
    },
  );
  return { runner: { run }, calls };
}

const queries = (calls: Call[]) =>
  calls.filter((call) => call.args.includes("--get"));

test("every call to the cluster names the environment's kube context, and the forward is the only kubectl call", async () => {
  const { runner, calls } = metricsStore();

  await readEvidence(
    repository,
    runner,
    ["kore:service_available_replicas"],
    window,
  );

  const kubectl = calls.filter((call) => call.command === "kubectl");
  expect(kubectl).toHaveLength(1);
  expect(kubectl[0]?.args.slice(0, 2)).toEqual(["--context", "kore-vps"]);
});

test("a recorded series is read over the window through the forward, and its names and values are returned", async () => {
  const { runner, calls } = metricsStore({
    query: (name) =>
      name === "kore:service_available_replicas"
        ? matrix([
            {
              metric: { __name__: name, service: "golden-path" },
              values: [
                [1_700_000_000, "2"],
                [1_700_000_060, "3"],
              ],
            },
          ])
        : matrix([]),
  });

  const readings = await readEvidence(
    repository,
    runner,
    ["kore:service_available_replicas", "kore:service_restarts"],
    window,
  );

  expect(readings).toEqual([
    {
      name: "kore:service_available_replicas",
      series: [
        {
          name: "kore:service_available_replicas",
          labels: { service: "golden-path" },
          samples: [
            { time: 1_700_000_000, value: 2 },
            { time: 1_700_000_060, value: 3 },
          ],
        },
      ],
    },
    { name: "kore:service_restarts", series: [] },
  ]);
  const [first] = queries(calls);
  expect(first?.args).toEqual(
    expect.arrayContaining([
      "query=kore:service_available_replicas",
      "start=1700000000",
      "end=1700000120",
      "step=60",
    ]),
  );
});

test("a forward that answers as something other than Prometheus is never ready, so no query is sent", async () => {
  const { runner, calls } = metricsStore({ buildinfo: '{"status":"ok"}' });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow("answers, but not as Prometheus");

  expect(queries(calls)).toHaveLength(0);
});

test("a forward that never reaches Prometheus is not ready, and the error names the forward and the cause", async () => {
  const { runner, calls } = metricsStore({
    buildinfo: refused(["--retry"]),
  });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow(
    /127\.0\.0\.1:30090 did not answer Prometheus.*Connection refused/,
  );

  expect(queries(calls)).toHaveLength(0);
});

test("a local port that already answers is refused before any forward starts, so one read never uses another forward", async () => {
  const { runner, calls } = metricsStore({ before: BUILDINFO });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow("127.0.0.1:30090 already answers");

  expect(calls.filter((call) => call.command === "kubectl")).toHaveLength(0);
});

test("a local port that cannot be checked is not read as free", async () => {
  const { runner, calls } = metricsStore({
    before: new Error("spawn curl ENOENT"),
  });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow("could not check whether 127.0.0.1:30090 is free");

  expect(calls.filter((call) => call.command === "kubectl")).toHaveLength(0);
});

test("a forward that exits before it answers fails with kubectl's cause, and no query is sent", async () => {
  const { runner, calls } = metricsStore({
    silentBuildinfo: true,
    exit: new CommandError("kubectl", [], {
      stdout: "",
      stderr: 'error: services "prometheus-server" not found',
      code: 1,
    }),
  });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow('services "prometheus-server" not found');

  expect(queries(calls)).toHaveLength(0);
});

test("a refused query fails naming the series and the cause, and never returns an empty series", async () => {
  const { runner } = metricsStore({
    query: () => refused(["--get"]),
  });

  await expect(
    readEvidence(
      repository,
      runner,
      ["kore:service_available_replicas"],
      window,
    ),
  ).rejects.toThrow(
    /reading kore:service_available_replicas from Prometheus failed.*Connection refused/,
  );
});

test("a Prometheus error answer fails with its error type and message", async () => {
  const { runner } = metricsStore({
    query: () =>
      JSON.stringify({
        status: "error",
        errorType: "execution",
        error: "query processing would load too many samples into memory",
      }),
  });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow(
    "Prometheus refused kore:service_restarts: execution: query processing would load too many samples",
  );
});

test("an answer that is not Prometheus JSON fails the query and reads no series", async () => {
  const { runner } = metricsStore({
    query: () => "<html>502 Bad Gateway</html>",
  });

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], window),
  ).rejects.toThrow(/not Prometheus JSON.*no series is read/);
});

test("a name with no samples in the window reads back as no series, so the caller judges it absent", async () => {
  const { runner } = metricsStore({ query: () => matrix([]) });

  const readings = await readEvidence(
    repository,
    runner,
    ["kore:service_restarts"],
    window,
  );

  expect(readings).toEqual([{ name: "kore:service_restarts", series: [] }]);
});

test("a name that is not a metric name is refused before any process starts", async () => {
  const { runner, calls } = metricsStore();

  await expect(
    readEvidence(repository, runner, ["up; drop"], window),
  ).rejects.toThrow("not a metric name");

  expect(calls).toHaveLength(0);
});

test("a window that does not end after it starts is refused before any process starts", async () => {
  const { runner, calls } = metricsStore();

  await expect(
    readEvidence(repository, runner, ["kore:service_restarts"], {
      ...window,
      end: window.start,
    }),
  ).rejects.toThrow("must end after it starts");

  expect(calls).toHaveLength(0);
});

test("the forward is stopped when the read ends, on success and on failure", async () => {
  const succeeding = metricsStore();
  await readEvidence(
    repository,
    succeeding.runner,
    ["kore:service_restarts"],
    window,
  );
  const [forwardOnSuccess] = succeeding.calls.filter(
    (call) => call.command === "kubectl",
  );
  expect(forwardOnSuccess?.options?.signal?.aborted).toBe(true);

  const failing = metricsStore({ query: () => refused(["--get"]) });
  await expect(
    readEvidence(repository, failing.runner, ["kore:service_restarts"], window),
  ).rejects.toThrow();
  const [forwardOnFailure] = failing.calls.filter(
    (call) => call.command === "kubectl",
  );
  expect(forwardOnFailure?.options?.signal?.aborted).toBe(true);
});
