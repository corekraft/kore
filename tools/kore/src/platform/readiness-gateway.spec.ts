// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { routeProblem } from "./gateway-proof.js";
import {
  gatewayCheck,
  waitForGateway,
  waitForHTTPRoute,
} from "./readiness-gateway.js";
import { pollUntil } from "./readiness-poll.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  featureEnabled: vi.fn(),
}));
vi.mock("./gateway-proof.js");
vi.mock("./readiness-poll.js");

const BASE = ["--context", "k3d-kore-local", "--namespace", "kore-system"];
const GATEWAY = "gateway/kore";

/** The environment's Gateway port maps to the load balancer's node port 30443. */
const repository = {
  environment: {
    kubeContext: "k3d-kore-local",
    gateway: { port: 8443 },
    k3d: { ports: [{ hostPort: 8443, loadBalancerPort: 30443 }] },
  },
} as unknown as Repository;

type Reply = Record<string, unknown>;

/**
 * A typed runner that answers each kubectl call with the JSON stored under the
 * first key its joined arguments contain; a key mapped to "" answers nothing.
 */
function kube(replies: Reply) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const joined = args.join(" ");
    const key = Object.keys(replies).find((candidate) =>
      joined.includes(candidate),
    );
    const answer = key === undefined ? {} : replies[key];
    return {
      stdout: typeof answer === "string" ? answer : JSON.stringify(answer),
      stderr: "",
      code: 0,
    };
  });
  return { runner: { run } as Runner, run };
}

/** A Gateway status with the given conditions and listener conditions. */
const gateway = (conditions: object[], listeners: object[] = []) => ({
  status: { conditions, listeners },
});
const accepted = { type: "Accepted", status: "True" };
const programmed = { type: "Programmed", status: "True" };
const published = {
  items: [
    {
      spec: { type: "LoadBalancer" },
      status: { loadBalancer: { ingress: [{ ip: "10.0.0.2" }] } },
    },
  ],
};
/** Every step passes: accepted, published, programmed and every listener resolved. */
const passing = {
  "gateway/kore": gateway(
    [accepted, programmed],
    [{ name: "https", conditions: [{ type: "ResolvedRefs", status: "True" }] }],
  ),
  "--selector": published,
};

beforeEach(() => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(routeProblem).mockReturnValue(undefined);
  // The default poll makes one probe; a reason becomes the failure.
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

test("a resource that is neither a Gateway nor an HTTPRoute has no gateway check", () => {
  expect(
    gatewayCheck(
      { repository, runner: {} as Runner, base: BASE },
      "deployment/web",
    ),
  ).toBeUndefined();
});

test("a Gateway without the ingress flag is checked for Accepted, an address, Programmed and ResolvedRefs", async () => {
  const { runner } = kube(passing);
  const check = gatewayCheck({ repository, runner, base: BASE }, GATEWAY);

  expect(check?.condition).toBe(
    "Accepted, LoadBalancer address or node port, Programmed, ResolvedRefs",
  );
  await check?.run("10m");
  expect(pollUntil).toHaveBeenCalledTimes(4);
  expect(vi.mocked(pollUntil).mock.calls.map(([timeout]) => timeout)).toEqual([
    "10m",
    "10m",
    "10m",
    "10m",
  ]);
});

test("with the ingress flag on, the Gateway's condition names the Istio release and the agentgateway class too", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);

  const check = gatewayCheck(
    { repository, runner: {} as Runner, base: BASE },
    GATEWAY,
  );

  expect(check?.condition).toBe(
    "Istio ingress proxy gone, GatewayClass agentgateway Accepted, Accepted, LoadBalancer address or node port, Programmed, ResolvedRefs",
  );
});

test("an HTTPRoute is checked for Accepted and ResolvedRefs, and is probed by the route proof", async () => {
  const { runner } = kube({ "httproute/web": { status: {} } });
  const check = gatewayCheck(
    { repository, runner, base: BASE },
    "httproute/web",
  );

  expect(check?.condition).toBe("Accepted and ResolvedRefs");
  await check?.run("10m");
  expect(routeProblem).toHaveBeenCalledWith({ status: {} });
});

test("a Gateway that is not Accepted fails naming the condition, its reason and its message", async () => {
  const { runner } = kube({
    "gateway/kore": gateway([
      {
        type: "Accepted",
        status: "False",
        reason: "InvalidParameters",
        message: "bad class",
      },
    ]),
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow("Accepted is False (reason: InvalidParameters): bad class");
});

test("a Gateway with no Accepted condition yet says it has not been reported", async () => {
  const { runner } = kube({ "gateway/kore": gateway([]) });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow("Accepted has not been reported yet");
});

test("a Service with a LoadBalancer address is published, and the wait passes", async () => {
  const { runner } = kube({
    "gateway/kore": gateway(
      [accepted, programmed],
      [
        {
          name: "https",
          conditions: [{ type: "ResolvedRefs", status: "True" }],
        },
      ],
    ),
    "--selector": published,
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).resolves.toBeUndefined();
});

test("a NodePort Service on the configured node port is published", async () => {
  const { runner } = kube({
    "gateway/kore": gateway([accepted, programmed]),
    "--selector": {
      items: [{ spec: { type: "NodePort", ports: [{ nodePort: 30443 }] } }],
    },
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).resolves.toBeUndefined();
});

test("a Service with no address and no node port is unpublished, naming Programmed as well", async () => {
  const { runner } = kube({
    "gateway/kore": gateway([accepted]),
    "--selector": { items: [{ spec: { type: "ClusterIP" } }] },
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow(
    "Service has no LoadBalancer address or node port; Programmed has not been reported yet",
  );
});

test("a node port other than the configured one is named as not assigned", async () => {
  const { runner } = kube({
    "gateway/kore": gateway([accepted]),
    "--selector": {
      items: [{ spec: { type: "NodePort", ports: [{ nodePort: 31000 }] } }],
    },
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow(
    "Service has node port 31000 but the configured node port 30443 is not assigned; Programmed has not been reported yet",
  );
});

test("a listener whose ResolvedRefs is False fails naming the listener and the reason", async () => {
  const { runner } = kube({
    "gateway/kore": gateway(
      [accepted, programmed],
      [
        {
          name: "https",
          conditions: [
            {
              type: "ResolvedRefs",
              status: "False",
              reason: "InvalidCertificateRef",
              message: "no secret",
            },
          ],
        },
      ],
    ),
    "--selector": published,
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow(
    "listener https ResolvedRefs is False (reason: InvalidCertificateRef): no secret",
  );
});

test("with the ingress flag on, a leftover Istio proxy fails with the command that removes it", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = kube({
    "deployment/kore-istio": "deployment/kore-istio",
    "gatewayclass/agentgateway": { status: { conditions: [accepted] } },
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow(
    "Istio ingress proxy deployment/kore-istio still exists; Istio has not released the Gateway to agentgateway. Remove it: kubectl --context k3d-kore-local --namespace kore-system delete deployment/kore-istio",
  );
});

test("with the ingress flag on, a GatewayClass agentgateway that has not accepted fails naming agentgateway's reason", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const { runner } = kube({
    "deployment/kore-istio": "",
    "service/kore-istio": "",
    "gatewayclass/agentgateway": {
      status: {
        conditions: [
          {
            type: "Accepted",
            status: "False",
            reason: "NotAccepted",
            message: "controller down",
          },
        ],
      },
    },
  });

  await expect(
    waitForGateway(repository, runner, BASE, GATEWAY, "10m"),
  ).rejects.toThrow(
    "agentgateway: GatewayClass Accepted is False (reason: NotAccepted): controller down",
  );
});

test("without the ingress flag, no Istio proxy or GatewayClass is read at all", async () => {
  const { runner, run } = kube({
    "gateway/kore": gateway(
      [accepted, programmed],
      [
        {
          name: "https",
          conditions: [{ type: "ResolvedRefs", status: "True" }],
        },
      ],
    ),
    "--selector": published,
  });

  await waitForGateway(repository, runner, BASE, GATEWAY, "10m");

  const joined = run.mock.calls.map(([, args]) => args.join(" "));
  expect(
    joined.some(
      (call) => call.includes("gatewayclass") || call.includes("-istio"),
    ),
  ).toBe(false);
});

test("an HTTPRoute the route proof rejects fails with the proof's reason", async () => {
  vi.mocked(routeProblem).mockReturnValue(
    "parent gateway/kore has not Accepted the route",
  );
  const { runner } = kube({ "httproute/web": { status: {} } });

  await expect(
    waitForHTTPRoute(runner, BASE, "httproute/web", "10m"),
  ).rejects.toThrow("parent gateway/kore has not Accepted the route");
});
