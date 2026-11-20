// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import { expect, test, vi } from "vitest";
import { postOtlpToName, type OtlpRequest } from "./otlp-name.js";

const ca = "-----BEGIN CERTIFICATE-----\nlocal\n-----END CERTIFICATE-----\n";
const payload = { resourceSpans: [] };

test("OTLP by name is posted as JSON to the name's signal path over HTTPS, verified against the local CA", async () => {
  const transport = vi.fn(async (_request: OtlpRequest) => ({
    status: 200,
    body: "",
  }));
  await postOtlpToName({
    url: "https://otlp.platform.kore.internal",
    ca,
    signal: "traces",
    payload,
    transport,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith({
    url: "https://otlp.platform.kore.internal/v1/traces",
    ca,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
});

test("an answer that is not 2xx fails naming the signal, the status and the body", async () => {
  const transport = vi.fn(async () => ({ status: 503, body: "unavailable" }));
  await expect(
    postOtlpToName({
      url: "https://otlp.platform.kore.internal",
      ca,
      signal: "logs",
      payload,
      transport,
    }),
  ).rejects.toThrow("Collector rejected OTLP logs: 503 unavailable");
});

test("a connection that fails names the route to check, never a bare timeout or socket error", async () => {
  const transport = vi.fn(async () => {
    throw new Error("socket hang up");
  });
  await expect(
    postOtlpToName({
      url: "https://otlp.platform.kore.internal",
      ca,
      signal: "metrics",
      payload,
      transport,
    }),
  ).rejects.toThrow(
    "could not reach https://otlp.platform.kore.internal for OTLP metrics (socket hang up); check that HTTPRoute otlp in observability is Accepted by the shared Gateway's https-platform listener, and that the local CA is trusted",
  );
});
