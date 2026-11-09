import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { loadRepository, type Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { ProcessRunner, type Runner } from "../runtime/index.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0019-telemetry-pipeline-wiring.md
// Live and opt-in: needs a converged local profile. It posts one synthetic
// OTLP/HTTP trace, log record, and counter to the Collector's documented
// endpoint, then reads each signal back from its backend. Everything goes
// through the API server's Service proxy, so no image, port-forward, or Pod is
// created and no Secret is read. The synthetic signals expire with the
// backends' bounded retention; there is nothing to delete.

const namespace = "observability";
const serviceName = "kore-telemetry-proof";

type Proxy = (service: string, path: string, body?: string) => Promise<string>;

function proxy(repository: Repository, runner: Runner): Proxy {
  return async (service, path, body) => {
    const raw = `/api/v1/namespaces/${namespace}/services/${service}/proxy${path}`;
    const { stdout } = await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        ...(body === undefined
          ? ["get", "--raw", raw]
          : ["create", "--raw", raw, "--filename", "-"]),
      ],
      {
        capture: true,
        cwd: repository.root,
        ...(body === undefined ? {} : { input: body }),
      },
    );
    return stdout;
  };
}

async function until<T>(
  description: string,
  attempt: () => Promise<T | undefined>,
  seconds = 120,
): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  let failure = "";
  while (Date.now() < deadline) {
    try {
      const result = await attempt();
      if (result !== undefined) {
        return result;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(
    `timed out after ${seconds}s waiting for ${description} ${failure}`,
  );
}

interface Signal {
  now: string;
  traceId: string;
  resource: object;
  attributes: object[];
}

function scope(): object {
  return { name: "kore.telemetry-proof" };
}

function tracePayload(
  { now, traceId, resource, attributes }: Signal,
  marker: string,
) {
  return {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: scope(),
            spans: [
              {
                traceId,
                spanId: traceId.slice(0, 16),
                name: `proof ${marker}`,
                kind: 2,
                startTimeUnixNano: now,
                endTimeUnixNano: String(BigInt(now) + 1_000_000n),
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

function logPayload(
  { now, traceId, resource, attributes }: Signal,
  marker: string,
) {
  return {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: scope(),
            logRecords: [
              {
                timeUnixNano: now,
                severityText: "INFO",
                body: { stringValue: `proof ${marker}` },
                traceId,
                spanId: traceId.slice(0, 16),
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

function metricPayload({ now, resource, attributes }: Signal) {
  const sum = {
    aggregationTemporality: 1,
    isMonotonic: true,
    dataPoints: [{ asInt: "1", timeUnixNano: now, attributes }],
  };
  return {
    resourceMetrics: [
      {
        resource,
        scopeMetrics: [
          {
            scope: scope(),
            metrics: [
              { name: "http.server.request.count", unit: "{request}", sum },
            ],
          },
        ],
      },
    ],
  };
}

function syntheticPayloads(traceId: string, marker: string) {
  const signal: Signal = {
    now: String(BigInt(Date.now()) * 1_000_000n),
    traceId,
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: serviceName } },
        { key: "k8s.namespace.name", value: { stringValue: "synthetic" } },
      ],
    },
    attributes: [
      { key: "http.route", value: { stringValue: marker } },
      { key: "http.response.status_code", value: { intValue: "200" } },
    ],
  };
  return {
    traces: tracePayload(signal, marker),
    logs: logPayload(signal, marker),
    metrics: metricPayload(signal),
  };
}

test(
  "a synthetic request yields a correlated metric, log, and trace in the backends",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 10 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local");
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    const call = proxy(repository, runner);
    const traceId = randomBytes(16).toString("hex");
    const marker = `/proof/${traceId.slice(0, 12)}`;
    const payloads = syntheticPayloads(traceId, marker);

    // The documented endpoint is the Collector's OTLP/HTTP port.
    for (const signal of ["traces", "logs", "metrics"] as const) {
      await call(
        "http:otel-collector:4318",
        `/v1/${signal}`,
        JSON.stringify(payloads[signal]),
      );
    }

    const trace = await until("Tempo to return the trace", async () => {
      const body = await call("http:tempo:3200", `/api/traces/${traceId}`);
      return body.includes(marker) ? body : undefined;
    });
    assert.ok(trace.includes(serviceName));
    assert.ok(
      trace.includes("deployment.environment.name"),
      "Collector enrichment",
    );
    assert.ok(trace.includes(repository.environment.name));

    const query = encodeURIComponent(
      `{service_name="${serviceName}"} |= "${marker}"`,
    );
    const logs = await until("Loki to return the log record", async () => {
      const now = Date.now() * 1_000_000;
      const body = await call(
        "http:loki:3100",
        `/loki/api/v1/query_range?query=${query}&start=${now - 600e9}&end=${now + 60e9}`,
      );
      return body.includes(traceId) ? body : undefined;
    });
    assert.ok(logs.includes(traceId), "the log record carries the trace id");

    const metric = encodeURIComponent(
      `http_server_request_count_total{service_name="${serviceName}",http_route="${marker}"}`,
    );
    const series = await until("Prometheus to return the counter", async () => {
      const body = await call(
        "http:prometheus-server:80",
        `/api/v1/query?query=${metric}`,
      );
      return (JSON.parse(body) as { data: { result: unknown[] } }).data.result
        .length > 0
        ? body
        : undefined;
    });
    assert.ok(series.includes(repository.environment.name));
  },
);

test(
  "Istio traffic exposes source and destination principals, and OPA decisions carry the trace header",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 10 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local");
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    const call = proxy(repository, runner);

    // Needs the `reference` application up (kore app up) and some traffic.
    const metric = encodeURIComponent(
      "istio_tcp_connections_opened_total{source_principal!='',destination_principal!=''}",
    );
    const body = await until(
      "ztunnel identity series in Prometheus",
      async () => {
        const text = await call(
          "http:prometheus-server:80",
          `/api/v1/query?query=${metric}`,
        );
        return (JSON.parse(text) as { data: { result: unknown[] } }).data.result
          .length > 0
          ? text
          : undefined;
      },
    );
    assert.match(body, /spiffe:\/\/cluster\.local\/ns\//);

    const decisions = encodeURIComponent(
      '{k8s_namespace_name="opa-system"} |= "traceparent" |= "decision_id"',
    );
    const now = Date.now() * 1_000_000;
    const logs = await call(
      "http:loki:3100",
      `/loki/api/v1/query_range?query=${decisions}&start=${now - 3600e9}&end=${now + 60e9}&limit=1`,
    );
    assert.match(
      logs,
      /traceparent/,
      "an OPA decision log carries the request's trace header (send /api/protected through the gateway first)",
    );
  },
);

test(
  "status degrades naming the Collector or a backend, read-only, and reports ready when healthy",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 10 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local");
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    const statuses = await platformStatus(repository, runner, [
      "otel-collector",
      "otel-agent",
      "prometheus",
      "loki",
      "tempo",
      "grafana",
    ]);
    for (const status of statuses) {
      assert.equal(status.status, "ready", `${status.name}: ${status.detail}`);
    }
  },
);
