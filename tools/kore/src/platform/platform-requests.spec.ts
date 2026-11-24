import { expect, test, vi } from "vitest";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  helmRenderer,
  platformRequests,
  podRequests,
  type RenderComponent,
} from "./platform-requests.js";

const container = (name: string, cpu?: string, memory?: string) => ({
  name,
  resources: {
    requests: {
      ...(cpu === undefined ? {} : { cpu }),
      ...(memory === undefined ? {} : { memory }),
    },
  },
});

const workload = (kind: string, name: string, spec: object) => ({
  apiVersion: "apps/v1",
  kind,
  metadata: { name },
  spec,
});

const template = (containers: object[], initContainers?: object[]) => ({
  template: {
    spec: {
      containers,
      ...(initContainers === undefined ? {} : { initContainers }),
    },
  },
});

const component = (
  name: string,
  kind: Component["kind"] = "helm",
): Component => ({
  name,
  kind,
  namespace: "kore-system",
  phase: "core",
  version: "1.0.0",
  ownsCRDs: [],
  dependencies: [],
  timeout: "1m",
  readiness: [],
});

test("podRequests sums each workload's pod requests, times its replicas", () => {
  const rendered = [
    workload("Deployment", "proxy", {
      replicas: 2,
      ...template([container("proxy", "100m", "128Mi")]),
    }),
    workload("StatefulSet", "db", {
      replicas: 1,
      ...template([container("postgres", "250m", "1Gi")]),
    }),
  ];
  expect(podRequests(rendered, 1)).toEqual({
    requests: { cpuMillis: 450, memoryMiB: 1280 },
    missing: [],
  });
});

test("podRequests counts a Deployment with no replica count as one pod", () => {
  const rendered = [
    workload("Deployment", "api", template([container("api", "10m", "16Mi")])),
  ];
  expect(podRequests(rendered, 1).requests).toEqual({
    cpuMillis: 10,
    memoryMiB: 16,
  });
});

test("podRequests counts a DaemonSet once on every node", () => {
  const rendered = [
    workload(
      "DaemonSet",
      "agent",
      template([container("agent", "50m", "64Mi")]),
    ),
  ];
  expect(podRequests(rendered, 2).requests).toEqual({
    cpuMillis: 100,
    memoryMiB: 128,
  });
});

test("podRequests counts a Job by its parallelism, and one when it sets none", () => {
  const rendered = [
    workload("Job", "migrate", {
      parallelism: 3,
      ...template([container("migrate", "10m", "16Mi")]),
    }),
    workload("Job", "seed", template([container("seed", "10m", "16Mi")])),
  ];
  expect(podRequests(rendered, 1).requests).toEqual({
    cpuMillis: 40,
    memoryMiB: 64,
  });
});

test("podRequests counts a bare Pod once", () => {
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "probe" },
    spec: { containers: [container("probe", "20m", "32Mi")] },
  };
  expect(podRequests([pod], 1).requests).toEqual({
    cpuMillis: 20,
    memoryMiB: 32,
  });
});

test("podRequests takes the largest init container over the containers' sum, not the sum of both", () => {
  const rendered = [
    workload(
      "Deployment",
      "api",
      template(
        [container("api", "100m", "100Mi"), container("log", "200m", "200Mi")],
        [container("migrate", "500m", "64Mi")],
      ),
    ),
  ];
  expect(podRequests(rendered, 1).requests).toEqual({
    cpuMillis: 500,
    memoryMiB: 300,
  });
});

test("podRequests adds a sidecar init container to the containers, since it runs beside them", () => {
  const sidecar = {
    ...container("mesh", "50m", "50Mi"),
    restartPolicy: "Always",
  };
  const rendered = [
    workload(
      "Deployment",
      "api",
      template(
        [container("api", "100m", "100Mi")],
        [sidecar, container("migrate", "120m", "10Mi")],
      ),
    ),
  ];
  expect(podRequests(rendered, 1).requests).toEqual({
    cpuMillis: 150,
    memoryMiB: 150,
  });
});

test("podRequests names each container with no cpu or memory request, rather than counting it as zero", () => {
  const rendered = [
    workload(
      "Deployment",
      "gateway",
      template([
        container("proxy", undefined, "128Mi"),
        container("sidecar", "10m"),
      ]),
    ),
  ];
  expect(podRequests(rendered, 1).missing).toEqual([
    "Deployment/gateway container proxy declares no cpu request",
    "Deployment/gateway container sidecar declares no memory request",
  ]);
});

test("podRequests names a request it cannot read, and does not count it", () => {
  const rendered = [
    workload("Deployment", "api", template([container("api", "1x", "16Mi")])),
  ];
  expect(podRequests(rendered, 1)).toEqual({
    requests: { cpuMillis: 0, memoryMiB: 16 },
    missing: [
      'Deployment/api container api declares an unreadable cpu request "1x"',
    ],
  });
});

test("podRequests reads nothing from kinds that hold no pods, and skips empty documents", () => {
  const rendered = [
    null,
    { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "settings" } },
    { apiVersion: "v1", kind: "Service", metadata: { name: "proxy" } },
  ];
  expect(podRequests(rendered, 1)).toEqual({
    requests: { cpuMillis: 0, memoryMiB: 0 },
    missing: [],
  });
});

test("platformRequests renders every chart and sums the pod requests of all of them", async () => {
  const render = vi.fn<RenderComponent>(async (target) =>
    target.name === "proxy"
      ? [
          workload("Deployment", "proxy", {
            replicas: 2,
            ...template([container("proxy", "100m", "128Mi")]),
          }),
        ]
      : [
          workload(
            "StatefulSet",
            "db",
            template([container("db", "250m", "1Gi")]),
          ),
        ],
  );
  const result = await platformRequests(
    [component("proxy"), component("db", "local-chart")],
    1,
    render,
  );
  expect(result).toEqual({
    requests: { cpuMillis: 450, memoryMiB: 1280 },
    missing: [],
  });
  expect(render).toHaveBeenCalledTimes(2);
});

test("platformRequests names a manifest it cannot render offline and never renders it", async () => {
  const render = vi.fn<RenderComponent>(async () => []);
  const result = await platformRequests(
    [component("gateway-api", "manifest"), component("proxy")],
    1,
    render,
  );
  expect(result.missing).toEqual([
    "gateway-api is a manifest the platform cannot render offline, so its pod requests are not read",
  ]);
  expect(render).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({ name: "proxy" }),
  );
});

test("platformRequests refuses to judge when a chart fails to render, rather than summing what did", async () => {
  const render = vi.fn<RenderComponent>(async (target) => {
    if (target.name === "db") {
      throw new Error("helm exited 1");
    }
    return [
      workload(
        "Deployment",
        "proxy",
        template([container("proxy", "100m", "128Mi")]),
      ),
    ];
  });
  await expect(
    platformRequests([component("proxy"), component("db")], 1, render),
  ).rejects.toThrow("helm exited 1");
});

test("helmRenderer renders a chart with helm and reads its documents as JSON with yq", async () => {
  const rendered = "kind: Deployment\n---\nkind: Service\n";
  const run = vi.fn<Runner["run"]>(async (command) => ({
    stdout:
      command === "helm"
        ? rendered
        : '{"kind":"Deployment"}\n{"kind":"Service"}\n',
    stderr: "",
    code: 0,
  }));
  const repository = {
    root: "/repo",
    environment: { name: "vps" },
    versions: { components: {} },
  } as unknown as Repository;
  const documents = await helmRenderer(repository, { run })(component("proxy"));
  expect(documents).toEqual([{ kind: "Deployment" }, { kind: "Service" }]);
  expect(run).toHaveBeenNthCalledWith(
    1,
    "helm",
    expect.arrayContaining(["template", "proxy"]),
    expect.objectContaining({ capture: true, cwd: "/repo" }),
  );
  expect(run).toHaveBeenNthCalledWith(2, "yq", ["-o=json", "-I=0", "."], {
    capture: true,
    input: rendered,
  });
});
