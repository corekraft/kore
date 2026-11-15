import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, gatewayClassName } from "../config/index.js";
import { releaseGatewayClassChange } from "./gateway-class-change.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import { pollUntil } from "./readiness-poll.js";

vi.mock("../config/index.js");
vi.mock("./readiness-poll.js");

const repository = fakeRepository();
const config = fakeComponent({
  name: "kore-platform-config",
  namespace: "kore-system",
  timeout: "10m",
});

/** A cluster whose Gateway has `current` class (empty: absent) and whose leftovers are `leftover`. */
function cluster(current: string, leftover = "") {
  return fakeRunner((_command, args) =>
    args.includes("jsonpath={.spec.gatewayClassName}") ? current : leftover,
  );
}
const deletes = (run: ReturnType<typeof fakeRunner>["run"]) =>
  run.mock.calls.filter(([, args]) => args.includes("delete"));

beforeEach(() => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(gatewayClassName).mockReturnValue("agentgateway");
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a Gateway in the old class is deleted, and only the Gateway", async () => {
  const { runner, run } = cluster("istio");
  await releaseGatewayClassChange(repository, runner, config);
  expect(deletes(run)).toEqual([
    [
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "--namespace",
        "kore-system",
        "delete",
        "gateway/kore-gateway",
        "--ignore-not-found",
      ],
      { capture: true },
    ],
  ]);
});

test("the class is read with kubectl get on the named context and namespace, never the current one", async () => {
  const { runner, run } = cluster("istio");
  await releaseGatewayClassChange(repository, runner, config);
  expect(run.mock.calls[0]).toEqual([
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "kore-system",
      "get",
      "gateway/kore-gateway",
      "--ignore-not-found",
      "--output",
      "jsonpath={.spec.gatewayClassName}",
    ],
    { capture: true },
  ]);
});

test("a Gateway already in the desired class is not deleted", async () => {
  const { runner, run } = cluster("agentgateway");
  await releaseGatewayClassChange(repository, runner, config);
  expect(deletes(run)).toEqual([]);
  expect(pollUntil).not.toHaveBeenCalled();
});

test("a fresh profile with no Gateway deletes nothing", async () => {
  const { runner, run } = cluster("");
  await releaseGatewayClassChange(repository, runner, config);
  expect(deletes(run)).toEqual([]);
});

test("the flag off keeps Istio and deletes nothing when the Gateway is already istio", async () => {
  vi.mocked(gatewayClassName).mockReturnValue("istio");
  const { runner, run } = cluster("istio");
  await releaseGatewayClassChange(repository, runner, config);
  expect(deletes(run)).toEqual([]);
});

test("turning the flag off deletes an agentgateway Gateway so Helm recreates it as istio", async () => {
  vi.mocked(gatewayClassName).mockReturnValue("istio");
  const { runner, run } = cluster("agentgateway");
  await releaseGatewayClassChange(repository, runner, config);
  expect(deletes(run)).toHaveLength(1);
});

test("a deployment or service is never deleted, even when the old proxy remains", async () => {
  const { runner, run } = cluster("istio", "deployment/kore-gateway-istio");
  await expect(
    releaseGatewayClassChange(repository, runner, config),
  ).rejects.toThrow();
  for (const [, args] of deletes(run)) {
    expect(args).toEqual(expect.not.arrayContaining(["deployment", "service"]));
    expect(args.join(" ")).not.toMatch(/deployment\/|service\//);
  }
});

test("a timeout names the Gateway and the leftover resource", async () => {
  const { runner } = cluster("istio", "deployment/kore-gateway-istio");
  await expect(
    releaseGatewayClassChange(repository, runner, config),
  ).rejects.toThrow(
    "Gateway kore-gateway is being handed to agentgateway but deployment/kore-gateway-istio still exists in kore-system; Kubernetes has not garbage-collected the old proxy. Check it with: kubectl --context k3d-kore-local --namespace kore-system get deployment,service",
  );
});

test("the wait covers the Gateway itself, bounded by the component timeout", async () => {
  const { runner } = cluster("istio", "gateway/kore-gateway");
  await expect(
    releaseGatewayClassChange(repository, runner, config),
  ).rejects.toThrow(/but gateway\/kore-gateway still exists/);
  expect(pollUntil).toHaveBeenCalledWith("10m", expect.any(Function));
});

test("a Gateway absent while the old proxy remains waits for the proxy, deleting nothing", async () => {
  const { runner, run } = cluster("", "deployment/kore-gateway-istio");
  await expect(
    releaseGatewayClassChange(repository, runner, config),
  ).rejects.toThrow(
    "Gateway kore-gateway is being handed to agentgateway but deployment/kore-gateway-istio still exists in kore-system; Kubernetes has not garbage-collected the old proxy. Check it with: kubectl --context k3d-kore-local --namespace kore-system get deployment,service",
  );
  expect(deletes(run)).toEqual([]);
});

test("a fresh profile with no Gateway and no proxy polls once and finds nothing to wait for", async () => {
  const { runner } = cluster("");
  await releaseGatewayClassChange(repository, runner, config);
  expect(pollUntil).toHaveBeenCalledTimes(1);
});

test("the deletion is announced once, before it happens, with the brief ingress outage", async () => {
  const write = vi.mocked(process.stderr.write);
  write.mockClear();
  const { runner, run } = cluster("istio");
  write.mockImplementation(() => {
    expect(deletes(run)).toEqual([]);
    return true;
  });
  await releaseGatewayClassChange(repository, runner, config);
  expect(write.mock.calls).toEqual([
    [
      "gateway/kore-gateway is being deleted and recreated for the class change from istio to agentgateway; ingress has a brief outage\n",
    ],
  ]);
});

test("nothing is announced when no class change happens", async () => {
  const write = vi.mocked(process.stderr.write);
  write.mockClear();
  await releaseGatewayClassChange(
    repository,
    cluster("agentgateway").runner,
    config,
  );
  expect(write).not.toHaveBeenCalled();
});

test("the flag off reads nothing and deletes nothing, even with a stale Gateway and proxy", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { runner, run } = cluster("istio", "deployment/kore-gateway-istio");
  await releaseGatewayClassChange(repository, runner, config);
  expect(run).not.toHaveBeenCalled();
  expect(pollUntil).not.toHaveBeenCalled();
  expect(process.stderr.write).not.toHaveBeenCalled();
});

test("the step is gated by gateway-class-change-release in the repository's environment", async () => {
  const { runner } = cluster("agentgateway");
  await releaseGatewayClassChange(repository, runner, config);
  expect(featureEnabled).toHaveBeenCalledWith(
    repository.environment,
    "gateway-class-change-release",
  );
});

test("any other component is left alone and no cluster call is made", async () => {
  const { runner, run } = cluster("istio");
  await releaseGatewayClassChange(repository, runner, fakeComponent());
  expect(run).not.toHaveBeenCalled();
});
