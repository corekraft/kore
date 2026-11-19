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
  customCheckReturns,
  primeReadinessFakes,
  repository,
  tails,
  waitOn,
} from "./readiness-support.js";

vi.mock("./probe.js");
vi.mock("./readiness-custom.js");
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
    "deployment/web not ready (rollout complete and a replica available) after 0.0s (timeout 10m): deployment/web has no available replicas (scaled to zero or none passing readiness)",
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

test("a wait that fails for another reason is rethrown at once, with no pause", async () => {
  const forbidden = () => new Error("forbidden: cannot list crds");
  const { wait } = waitOn(["crd/x"], forbidden);
  await expect(wait()).rejects.toThrow("forbidden");
  expect(pause).not.toHaveBeenCalled();
});

test("a readiness failure names the time its check ran, not the bound it may not have reached", async () => {
  let clock = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  customCheckReturns(async () => {
    clock += 1200;
    throw new Error("gateway refused");
  });
  const { wait } = waitOn(["gateway/web"]);

  await expect(wait()).rejects.toThrow(
    "gateway/web not ready (gateway accepted) after 1.2s (timeout 10m): gateway refused",
  );
});

test("a Crossplane Function is proven Installed and then Healthy, in that order", async () => {
  const { run, wait } = waitOn(["function.pkg.crossplane.io/kcl"]);

  await wait();
  expect(tails(run).map(([flag]) => flag)).toEqual([
    "--for=condition=Installed",
    "--for=condition=Healthy",
  ]);
});

test("a Crossplane Provider is proven Installed and then Healthy, never by rollout status", async () => {
  const { run, wait } = waitOn([
    "provider.pkg.crossplane.io/provider-keycloak",
  ]);

  await wait();
  expect(tails(run)).toEqual([
    [
      "--for=condition=Installed",
      "provider.pkg.crossplane.io/provider-keycloak",
      "--timeout=10m",
    ],
    [
      "--for=condition=Healthy",
      "provider.pkg.crossplane.io/provider-keycloak",
      "--timeout=10m",
    ],
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

test("the metrics APIService is proven Available, so a metrics-server that is up but unregistered is not ready", async () => {
  const { run, wait } = waitOn([
    "apiservice.apiregistration.k8s.io/v1beta1.metrics.k8s.io",
  ]);

  await wait();
  expect(tails(run)).toEqual([
    [
      "--for=condition=Available",
      "apiservice.apiregistration.k8s.io/v1beta1.metrics.k8s.io",
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
    "secret/web-tls not ready (complete TLS Secret) after 0.0s (timeout 10m): Secret is missing tls.crt or tls.key",
  );
});

test("a TLS Secret cert-manager has not issued names the remedy", async () => {
  const { wait } = waitOn(
    ["secret/web-tls"],
    () => new Error('secrets "web-tls" not found'),
  );

  await expect(wait()).rejects.toThrow(
    'secret/web-tls not ready (complete TLS Secret) after 0.0s (timeout 10m): secrets "web-tls" not found. cert-manager has not issued it; Run: kore trust install --environment local',
  );
});

test("a TLS Secret read that fails for another reason is rethrown without a remedy", async () => {
  const { wait } = waitOn(
    ["secret/web-tls"],
    () => new Error("forbidden: secrets is forbidden"),
  );

  const error = await wait().catch((caught: unknown) => caught);

  expect(errorMessage(error)).toBe(
    "secret/web-tls not ready (complete TLS Secret) after 0.0s (timeout 10m): forbidden: secrets is forbidden",
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

test("a resource with a custom check is checked by it, not the rollout", async () => {
  const check = vi.fn(async () => undefined);
  customCheckReturns(check);
  const { run, wait } = waitOn(["gateway/kore"]);

  await wait();

  expect(check).toHaveBeenCalledWith("10m");
  expect(run).not.toHaveBeenCalled();
});

test("a failing custom check fails the component's readiness naming the resource, condition and cause", async () => {
  customCheckReturns(async () => {
    throw new Error(
      "Application kore-local-tls is OutOfSync and Missing: chart digest is not signed",
    );
  });
  const { wait } = waitOn(["applications.argoproj.io"]);

  await expect(wait()).rejects.toThrow(
    "applications.argoproj.io not ready (gateway accepted) after 0.0s (timeout 10m): Application kore-local-tls is OutOfSync and Missing: chart digest is not signed",
  );
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
    "statefulset/db not ready (rollout complete) after 0.0s (timeout 10m)",
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
