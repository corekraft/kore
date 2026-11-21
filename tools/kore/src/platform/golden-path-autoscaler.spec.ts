import { expect, test } from "vitest";
import { autoscalerOf } from "./golden-path-autoscaler.js";

const listing = (...items: unknown[]) => JSON.stringify({ items });
const hpa = (name: string, behavior?: unknown) => ({
  spec: {
    scaleTargetRef: { kind: "Deployment", name },
    minReplicas: 2,
    maxReplicas: 5,
    ...(behavior === undefined ? {} : { behavior }),
  },
});

test("reads the scale-down stabilization window the autoscaler sets, so the scale-in waits that window", () => {
  const found = autoscalerOf(
    listing(
      hpa("golden-path-example-bff", {
        scaleDown: { stabilizationWindowSeconds: 600 },
      }),
    ),
    "golden-path-example-bff",
  );

  expect(found).toEqual({
    minReplicas: 2,
    maxReplicas: 5,
    scaleDownWindowSeconds: 600,
  });
});

test("takes the Kubernetes default 300 s window when the autoscaler sets no behavior", () => {
  const found = autoscalerOf(
    listing(hpa("golden-path-example-bff")),
    "golden-path-example-bff",
  );

  expect(found?.scaleDownWindowSeconds).toBe(300);
});

test("takes the 300 s default window when the autoscaler sets a scale-down without a window", () => {
  const found = autoscalerOf(
    listing(hpa("golden-path-example-bff", { scaleDown: {} })),
    "golden-path-example-bff",
  );

  expect(found?.scaleDownWindowSeconds).toBe(300);
});

test("finds only the autoscaler that targets the named Deployment, and none when no autoscaler does", () => {
  const other = listing(hpa("golden-path-example-frontend"));

  expect(autoscalerOf(other, "golden-path-example-bff")).toBeUndefined();
  expect(autoscalerOf(listing(), "golden-path-example-bff")).toBeUndefined();
});

test("reads a listing with no items as having no autoscaler, so the check refuses it", () => {
  expect(autoscalerOf("{}", "golden-path-example-bff")).toBeUndefined();
});
