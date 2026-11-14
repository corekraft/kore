import { beforeEach, expect, test, vi } from "vitest";
import { errorMessage } from "./probe.js";
import { assertIssuerReady } from "./readiness-issuer.js";
import {
  failureAcrossBounds,
  pause,
  pollUntil,
  retryBudget,
} from "./readiness-poll.js";
import { readinessFailure } from "./readiness.js";
import { withScheduledPods } from "./readiness-daemonset.js";
import { waitForWebhook } from "./readiness-webhook.js";
import {
  AVAILABLE,
  BASE,
  CAPTURE,
  NO_CAPTURE,
  component,
  gatewayCheckReturns,
  primeReadinessFakes,
  repository,
  tails,
  waitOn,
} from "./readiness-support.js";

vi.mock("./probe.js");
vi.mock("./readiness-gateway.js");
vi.mock("./readiness-issuer.js");
vi.mock("./readiness-daemonset.js");
vi.mock("./readiness-webhook.js");
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
  failureAcrossBounds: vi.fn(),
  pause: vi.fn(),
  timeoutMilliseconds: vi.fn(),
  retryBudget: vi.fn(),
}));

beforeEach(primeReadinessFakes);
test("a deployment is ready when its rollout completes and it has an available replica", async () => {
  const { run, wait } = waitOn(["deployment/web"], (args) =>
    args.includes("get") ? "available" : "",
  );

  await wait();

  expect(tails(run)).toEqual([
    ["status", "deployment/web", "--timeout=10m"],
    ["deployment/web", "--output", AVAILABLE],
  ]);
  expect(run.mock.calls.map((call) => call[2])).toEqual([NO_CAPTURE, CAPTURE]);
});

test("a deployment scaled to zero fails naming it, even though its rollout reports complete", async () => {
  const { wait } = waitOn(["deployment/web"], () => "");

  await expect(wait()).rejects.toThrow(
    "deployment/web not ready (rollout complete and a replica available) within 10m: deployment/web has no available replicas (scaled to zero or none passing readiness)",
  );
});

test("a rollout-only resource is waited on with its rollout status alone", async () => {
  const { run, wait } = waitOn(["statefulset/db"]);

  await wait();

  expect(tails(run)).toEqual([["status", "statefulset/db", "--timeout=10m"]]);
});

test("a DaemonSet is handed to the scheduled-pods check with the base arguments, and its run gets the bound", async () => {
  const run = vi.fn(async () => undefined);
  vi.mocked(withScheduledPods).mockReturnValue({
    condition: "pods scheduled",
    run,
  });
  const { runner, wait } = waitOn(["daemonset/ztunnel"]);

  await wait();

  expect(withScheduledPods).toHaveBeenCalledWith(
    expect.objectContaining({ base: BASE, capture: false, runner }),
    "daemonset/ztunnel",
    expect.objectContaining({ run: expect.any(Function) }),
  );
  expect(run).toHaveBeenCalledWith("10m");
});

test("a CRD is proven Established in the environment's context, with no namespace", async () => {
  const { run, wait } = waitOn(["crd/fakes.example.io"]);

  await wait();

  expect(tails(run)).toEqual([
    ["--for=condition=Established", "crd/fakes.example.io", "--timeout=10m"],
  ]);
  expect(run.mock.calls[0]?.[1]).not.toContain("--namespace");
});

test("a CRD that does not exist yet is retried after a pause until it is Established", async () => {
  let attempts = 0;
  const { run, wait } = waitOn(["crd/x"], () => {
    attempts += 1;
    return attempts === 1
      ? new Error(
          'Error from server (NotFound): customresourcedefinitions "x" not found',
        )
      : "";
  });

  await wait();

  expect(pause).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(2);
});

test("a wait that fails for another reason is rethrown at once, with no pause", async () => {
  const { wait } = waitOn(
    ["crd/x"],
    () => new Error("forbidden: cannot list crds"),
  );

  await expect(wait()).rejects.toThrow("forbidden");

  expect(pause).not.toHaveBeenCalled();
});

test("a Crossplane Function is proven Installed and then Healthy, in that order", async () => {
  const { run, wait } = waitOn(["function.pkg.crossplane.io/kcl"]);

  await wait();

  expect(tails(run).map(([flag]) => flag)).toEqual([
    "--for=condition=Installed",
    "--for=condition=Healthy",
  ]);
});

test("a ClusterImagePolicy is proven Ready", async () => {
  const { run, wait } = waitOn([
    "clusterimagepolicy.policy.sigstore.dev/signed",
  ]);

  await wait();

  expect(tails(run)).toEqual([
    [
      "--for=condition=Ready",
      "clusterimagepolicy.policy.sigstore.dev/signed",
      "--timeout=10m",
    ],
  ]);
});

test("a TLS Secret with both key halves is ready, and is probed within the bound", async () => {
  const { wait } = waitOn(["secret/web-tls"], () => "ready\n");

  await wait();

  expect(pollUntil).toHaveBeenCalledWith("10m", expect.any(Function));
});

test("a TLS Secret that exists without its key material names the missing halves", async () => {
  const { wait } = waitOn(["secret/web-tls"], () => "");

  await expect(wait()).rejects.toThrow(
    "secret/web-tls not ready (complete TLS Secret) within 10m: Secret is missing tls.crt or tls.key",
  );
});

test("a TLS Secret cert-manager has not issued names the remedy", async () => {
  const { wait } = waitOn(
    ["secret/web-tls"],
    () => new Error('secrets "web-tls" not found'),
  );

  await expect(wait()).rejects.toThrow(
    'secret/web-tls not ready (complete TLS Secret) within 10m: secrets "web-tls" not found. cert-manager has not issued it; Run: kore trust install --environment local',
  );
});

test("a TLS Secret read that fails for another reason is rethrown without a remedy", async () => {
  const { wait } = waitOn(
    ["secret/web-tls"],
    () => new Error("forbidden: secrets is forbidden"),
  );

  const error = await wait().catch((caught: unknown) => caught);

  expect(errorMessage(error)).toBe(
    "secret/web-tls not ready (complete TLS Secret) within 10m: forbidden: secrets is forbidden",
  );
});

test("a webhook configuration is delegated to the webhook wait with the context, the resource and the bound", async () => {
  const { runner, wait } = waitOn(["validatingwebhookconfiguration/demo"]);

  await wait();

  expect(waitForWebhook).toHaveBeenCalledWith(
    runner,
    "k3d-kore-local",
    "validatingwebhookconfiguration/demo",
    "10m",
  );
});

test("a gateway resource is checked by the gateway check, not the rollout", async () => {
  const check = vi.fn(async () => undefined);
  gatewayCheckReturns(check);
  const { run, wait } = waitOn(["gateway/kore"]);

  await wait();

  expect(check).toHaveBeenCalledWith("10m");
  expect(run).not.toHaveBeenCalled();
});

test("a Gatekeeper constraint and a ConfigMap are proven by existing, not by a condition", async () => {
  const { run, wait } = waitOn([
    "k8sallowed.constraints.gatekeeper.sh/web",
    "configmap/settings",
  ]);

  await wait();

  expect(tails(run)).toEqual([
    ["k8sallowed.constraints.gatekeeper.sh/web", "--output", "name"],
    ["configmap/settings", "--output", "name"],
  ]);
});

test("a certificate's issuer is checked before its Ready wait, and a failed issuer check means no wait", async () => {
  vi.mocked(assertIssuerReady).mockRejectedValue(
    new Error("ClusterIssuer kore-local-ca is missing"),
  );
  const { runner, run, wait } = waitOn(["certificate/gateway-tls"]);

  await expect(wait()).rejects.toThrow(
    "ClusterIssuer kore-local-ca is missing",
  );

  expect(assertIssuerReady).toHaveBeenCalledWith(
    repository,
    runner,
    BASE,
    "certificate/gateway-tls",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a certificate whose issuer is present is proven Ready", async () => {
  const { run, wait } = waitOn(["certificate/gateway-tls"]);

  await wait();

  expect(tails(run)).toEqual([
    ["--for=condition=Ready", "certificate/gateway-tls", "--timeout=10m"],
  ]);
});

test("the first failing resource stops the wait, so no later resource is checked", async () => {
  const { run, wait } = waitOn(
    ["statefulset/db", "statefulset/cache"],
    (args) =>
      args.includes("statefulset/db")
        ? new Error("timed out waiting for the rollout")
        : "",
  );

  await expect(wait()).rejects.toThrow(
    "statefulset/db not ready (rollout complete) within 10m",
  );

  expect(tails(run)).toEqual([["status", "statefulset/db", "--timeout=10m"]]);
});

test("each owned CRD is checked after the readiness resources, as crd/<name>", async () => {
  const { run, wait } = waitOn(["statefulset/db"], undefined, {
    ownsCRDs: ["fakes.example.io"],
  });

  await wait();

  expect(tails(run)).toEqual([
    ["status", "statefulset/db", "--timeout=10m"],
    ["--for=condition=Established", "crd/fakes.example.io", "--timeout=10m"],
  ]);
});

test("a status read runs at the 3s then 15s bounds, with capture on and the shared budget, and reports no failure when every check passes", async () => {
  const budget = { spent: false };
  vi.mocked(retryBudget).mockReturnValue(budget);
  const { runner, run } = waitOn([]);

  const failure = await readinessFailure(
    repository,
    runner,
    component({ readiness: ["statefulset/db"] }),
    budget,
  );

  expect(failure).toBeUndefined();
  expect(failureAcrossBounds).toHaveBeenCalledWith(
    ["3s", "15s"],
    expect.any(Function),
    budget,
  );
  expect(run.mock.calls[0]?.[2]).toEqual(CAPTURE);
});
