import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadRepository, type Repository } from "../config/index.js";
import {
  ProcessRunner,
  liveEnvironment,
  type Runner,
} from "../runtime/index.js";
import {
  externalDnsLogProblems,
  outcomeArgs,
  proofDomain,
  proofFlags,
  proofRoutes,
  proofRoutesManifest,
} from "./external-dns-proof.js";

// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
// Live and opt-in: local only, on the throwaway copy from `npm run external-dns:proof-root -- <new directory>`,
// converged with `KORE_ROOT=<that copy> kore local up`. Run it with KORE_RUN_LIVE=1, KORE_ROOT=<that copy> and
// KORE_EXTERNAL_DNS_IDEA=<the idea that records the proof>, through `npm run test:live:external-dns` in tools/kore.
// It creates three HTTPRoutes on the external Gateway, waits for one reconcile of the 5-minute interval, reads
// external-dns's log since the routes went in, and checks it (external-dns-proof.ts). Only a green run records the
// outcome, through harness outcome record in this checkout. It removes its routes afterwards.
//
// The inmemory provider has no read API, so the log is the evidence. The Cloudflare read-back is not covered here.
// Every kubectl call names the environment's kubeContext, never the current one (AGENTS.md, Safety).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into the local external-dns proof"
      : false,
  timeout: 30 * 60 * 1000,
};

const namespace = "kore-external-dns";
const deployment = "deploy/external-dns";
const routeNamespace = "kore-system";
const proofLabel = "platform.kore.dev/proof=external-dns";
/** The controller reconciles every 5 minutes (infra/environments/common/values/external-dns.yaml), so the wait covers two. */
const reconcileDeadlineMs = 12 * 60 * 1000;
const pollMs = 15 * 1000;

// RFC 3339 without milliseconds, which kubectl's --since-time reads.
const rfc3339 = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Kubectl = (args: string[], input?: string) => Promise<string>;

/** A kubectl that names the environment's context, and fails with stderr when kubectl does. */
function kubectlFor(runner: Runner, repository: Repository): Kubectl {
  return async (args, input) => {
    const result = await runner.run(
      "kubectl",
      ["--context", repository.environment.kubeContext, ...args],
      {
        cwd: repository.root,
        capture: true,
        ...(input === undefined ? {} : { input }),
      },
    );
    if (result.code !== 0) {
      throw new Error(
        `kubectl ${args.join(" ")} failed: ${result.stderr.trim()}`,
      );
    }
    return result.stdout;
  };
}

/** external-dns's log since the routes went in. */
const logsSince = (kubectl: Kubectl, startedAt: string) =>
  kubectl(["logs", deployment, "-n", namespace, `--since-time=${startedAt}`]);

/** Polls the log until it names the published name, then waits one more interval so the reconcile has finished. */
async function reconciledLogs(kubectl: Kubectl, startedAt: string) {
  const deadline = Date.now() + reconcileDeadlineMs;
  let logs = await logsSince(kubectl, startedAt);
  while (!logs.includes(proofRoutes.published.hostname)) {
    assert.ok(
      Date.now() < deadline,
      `external-dns logged nothing about ${proofRoutes.published.hostname} within 12 minutes of the routes going in: check that the external Gateway is up and that the copy has external-dns on`,
    );
    await sleep(pollMs);
    logs = await logsSince(kubectl, startedAt);
  }
  await sleep(pollMs);
  return logsSince(kubectl, startedAt);
}

/** Records the confirmed verification through harness outcome record, from this checkout; throws when the harness refuses it. */
async function recordOutcome(
  runner: Runner,
  repository: Repository,
  idea: string,
  startedAt: string,
): Promise<void> {
  const sha = (
    await runner.run("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repository.root,
      capture: true,
    })
  ).stdout.trim();
  const evidence = `external-dns live proof on ${sha}: kubectl logs of ${namespace}/external-dns since ${startedAt}`;
  // The idea file is in this checkout; the copy is only the cluster's root.
  const checkout = resolve(process.cwd(), "../..");
  const recorded = await runner.run(
    process.execPath,
    [
      resolve(checkout, "skills/bin/harness.mjs"),
      ...outcomeArgs(idea, evidence),
    ],
    { cwd: checkout, capture: true },
  );
  assert.equal(
    recorded.code,
    0,
    `harness outcome record refused the proof: ${recorded.stderr.trim() || recorded.stdout.trim()}`,
  );
}

test(
  "external-dns plans the published name's A and ownership TXT, plans nothing for the names outside its filter, and records the outcome",
  live,
  async () => {
    // Refused before any mutation: the outcome needs an idea, and the copy must be the proof's.
    const idea = process.env["KORE_EXTERNAL_DNS_IDEA"] ?? "";
    assert.ok(
      idea.trim() !== "",
      "set KORE_EXTERNAL_DNS_IDEA to the idea that records this proof (its number or slug, from harness idea list)",
    );
    const repository = await loadRepository(liveEnvironment());
    const { environment, root } = repository;
    const missing = proofFlags.filter(
      (flag) => environment.features?.[flag] !== true,
    );
    assert.deepEqual(
      missing,
      [],
      `the copy at ${root} does not turn on ${missing.join(", ")}: make it with npm run external-dns:proof-root -- <new directory>, converge that copy with KORE_ROOT set to it, then run this test with the same KORE_ROOT`,
    );
    assert.equal(
      environment.platform.domain,
      proofDomain,
      `the copy at ${root} names ${environment.platform.domain}, not ${proofDomain}: the proof names sit under ${proofDomain}`,
    );

    const runner = new ProcessRunner();
    const kubectl = kubectlFor(runner, repository);
    await kubectl([
      "wait",
      "--for=condition=available",
      deployment,
      "-n",
      namespace,
      "--timeout=180s",
    ]);
    const startedAt = rfc3339(new Date());
    try {
      await kubectl(["apply", "-f", "-"], proofRoutesManifest());
      const problems = externalDnsLogProblems(
        await reconciledLogs(kubectl, startedAt),
      );
      assert.deepEqual(
        problems,
        [],
        `external-dns's log does not show the proof:\n${problems.join("\n")}`,
      );
      await recordOutcome(runner, repository, idea, startedAt);
    } finally {
      await kubectl([
        "delete",
        "httproute",
        "-n",
        routeNamespace,
        "-l",
        proofLabel,
        "--ignore-not-found",
      ]).catch((error: unknown) => {
        console.error(
          `the proof's routes were not removed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  },
);
