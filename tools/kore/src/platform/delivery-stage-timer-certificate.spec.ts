import { beforeEach, expect, test, vi } from "vitest";
import { mergedMilliseconds, stageTimes } from "./delivery-stage-timeline.js";
import {
  COLD,
  MERGED_MS,
  NOT_FOUND,
  SHARED_ROUTE,
  STAGES,
  readOrder,
  timerWith,
} from "./delivery-stage-timer-fixtures.js";

// The merge check and the stage arithmetic are same-domain pure helpers, so they
// are stubs here (ADR 0098). Their own spec proves the arithmetic; the constants
// stay real.
vi.mock("./delivery-stage-timeline.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./delivery-stage-timeline.js")>()),
  mergedMilliseconds: vi.fn(),
  stageTimes: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(mergedMilliseconds).mockReset();
  vi.mocked(stageTimes).mockReset();
  vi.mocked(mergedMilliseconds).mockReturnValue(MERGED_MS);
  vi.mocked(stageTimes).mockReturnValue({ stages: STAGES, totalSeconds: 85 });
});

test("with the Service's shared HTTPRoute Accepted=True, the certificate stage ends at that time, and no Certificate is read", async () => {
  const { timer, run } = timerWith({ ...COLD, route: SHARED_ROUTE });

  await timer.measure();

  expect(stageTimes).toHaveBeenCalledExactlyOnceWith(MERGED_MS, [
    ["namespace", Date.parse("2026-11-18T10:00:05Z")],
    ["sync", Date.parse("2026-11-18T10:00:15Z")],
    ["admission", Date.parse("2026-11-18T10:00:17Z")],
    ["certificate", Date.parse("2026-11-18T10:00:40Z")],
    ["rollout", Date.parse("2026-11-18T10:01:20Z")],
    ["readiness", Date.parse("2026-11-18T10:01:25Z")],
  ]);
  expect(readOrder(run)).toEqual([
    "namespace",
    "application",
    "pods",
    "httproute",
    "deployments",
  ]);
});

test("with no shared HTTPRoute, the certificate stage ends at the Service's own Certificate Ready time, after the route is found absent", async () => {
  const { timer, run } = timerWith(COLD);

  await timer.measure();

  expect(stageTimes).toHaveBeenCalledExactlyOnceWith(MERGED_MS, [
    ["namespace", Date.parse("2026-11-18T10:00:05Z")],
    ["sync", Date.parse("2026-11-18T10:00:15Z")],
    ["admission", Date.parse("2026-11-18T10:00:17Z")],
    ["certificate", Date.parse("2026-11-18T10:00:50Z")],
    ["rollout", Date.parse("2026-11-18T10:01:20Z")],
    ["readiness", Date.parse("2026-11-18T10:01:25Z")],
  ]);
  expect(readOrder(run)).toEqual([
    "namespace",
    "application",
    "pods",
    "httproute",
    "certificate",
    "deployments",
  ]);
});

test("with neither a shared HTTPRoute nor a Certificate, the run fails naming the certificate stage and both sources", async () => {
  const { timer } = timerWith({ ...COLD, certificate: NOT_FOUND });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: neither the HTTPRoute shop-shared nor the Certificate shop-tls exists in shop--local; check that the Service\'s route or certificate is applied',
    ),
  );
});

test("a shared HTTPRoute with no True Accepted condition fails the run naming the certificate stage, and no Certificate is read", async () => {
  const { timer, run } = timerWith({
    ...COLD,
    route: {
      status: {
        parents: [
          {
            conditions: [
              {
                type: "Accepted",
                status: "False",
                lastTransitionTime: "2026-11-18T10:00:40Z",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: HTTPRoute shop-shared has no True Accepted condition',
    ),
  );
  expect(readOrder(run)).toEqual([
    "namespace",
    "application",
    "pods",
    "httproute",
  ]);
});

test("a shared HTTPRoute with no status.parents fails the run naming the certificate stage", async () => {
  const { timer } = timerWith({ ...COLD, route: { status: {} } });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: HTTPRoute shop-shared has no True Accepted condition',
    ),
  );
});

test("a shared HTTPRoute read that fails for a reason other than NotFound fails the run naming the route, with no fallback to the Certificate", async () => {
  const { timer, run } = timerWith({ ...COLD, route: undefined });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: reading the HTTPRoute shop-shared failed: unexpected read kubectl --context k3d-kore-local -n shop--local get httproute shop-shared -o json; check that kubectl can reach the k3d-kore-local context',
    ),
  );
  expect(readOrder(run)).toEqual([
    "namespace",
    "application",
    "pods",
    "httproute",
  ]);
});
