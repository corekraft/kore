// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { beforeEach, expect, test, vi } from "vitest";
import {
  chartDeliveryErrors,
  chartDeliveryValues,
  chartRepositoryUrls,
} from "./chart-delivery.js";
import { gatewayClassName } from "./features.js";
import { fakeComponent, fakeRepository, malformed } from "./config-support.js";

vi.mock("./features.js");

const digest = (n: number) => `sha256:${n.toString(16).repeat(64)}`;
const repository = fakeRepository({
  catalog: {
    components: [
      fakeComponent({ name: "kore-image-policy", namespace: "kore-system" }),
      fakeComponent({
        name: "kore-local-tls",
        namespace: "cert",
        owner: "argocd",
      }),
      fakeComponent({
        name: "opa-authorizer",
        namespace: "opa",
        owner: "argocd",
      }),
    ],
  },
});
const entry = (name: string, n: number) => ({
  chart: `reg.example:5000/charts/${name}`,
  version: "0.0.0-0123456789ab",
  digest: digest(n),
  signer: "s",
});
const lock = (entries: Record<string, unknown> = {}) => ({
  version: 1,
  authorizedSigners: ["s"],
  entries: {
    "kore-local-tls": entry("kore-local-tls", 1),
    "opa-authorizer": entry("opa-authorizer", 2),
    ...entries,
  },
});

beforeEach(() => {
  vi.mocked(gatewayClassName).mockReturnValue("istio");
});

test("the values are the lock's chart and digest and the catalog's namespace for each argocd release", () => {
  expect(chartDeliveryValues(repository, lock())).toEqual({
    charts: {
      "kore-local-tls": {
        chart: "reg.example:5000/charts/kore-local-tls",
        digest: digest(1),
      },
      "opa-authorizer": {
        chart: "reg.example:5000/charts/opa-authorizer",
        digest: digest(2),
      },
    },
    namespaces: { "kore-local-tls": "cert", "opa-authorizer": "opa" },
    gatewayClassName: "istio",
  });
});

test("the image policy never reaches the values, and a lock entry for it is refused", () => {
  expect(chartDeliveryErrors(repository, lock())).toEqual([]);
  expect(
    chartDeliveryErrors(
      repository,
      lock({ "kore-image-policy": entry("kore-image-policy", 3) }),
    ),
  ).toEqual([
    "platform chart lock: entry kore-image-policy must not exist; kore keeps the image policy (ADR 0028), so publish the release without it",
  ]);
});

test("a release with no lock entry is named with the fix", () => {
  const partial = lock();
  delete (partial.entries as Record<string, unknown>)["opa-authorizer"];
  expect(chartDeliveryErrors(repository, partial)).toEqual([
    "platform chart lock: no entry for release opa-authorizer; pass the platform-charts.lock.json of the release that published it",
  ]);
});

test("a digest that is not sha256 and a chart that is not an OCI path are named by release", () => {
  expect(
    chartDeliveryErrors(
      repository,
      lock({
        "opa-authorizer": { chart: "oci://x/y", digest: "v1.2.3" },
      }),
    ),
  ).toEqual([
    "platform chart lock: opa-authorizer digest must be sha256:<64 hex>, never a version or tag; republish the release",
    "platform chart lock: opa-authorizer chart must be an OCI path without a scheme, such as <registry>/<path>/opa-authorizer; republish the release",
  ]);
});

test.each([[null], ["x"], [{ version: 2, entries: {} }], [{ version: 1 }]])(
  "a lock that is not a version 1 chart lock is refused whole: %j",
  (value) => {
    expect(chartDeliveryErrors(repository, malformed(value))).toEqual([
      "platform chart lock: expected {version: 1, entries: {<release>: {chart, digest}}}; pass the platform-charts.lock.json attached to the release",
    ]);
  },
);

test("an environment whose catalog hands over nothing has nothing to compose", () => {
  expect(
    chartDeliveryErrors(
      fakeRepository({ catalog: { components: [] } }),
      lock(),
    ),
  ).toEqual([
    "no catalog release has owner argocd, so kore-config-delivery has nothing to deliver; set owner: argocd on the releases to hand over",
  ]);
});

test("values refuse to build from a bad lock, naming every problem", () => {
  expect(() => chartDeliveryValues(repository, malformed(null))).toThrow(
    /^platform chart lock: expected \{version: 1/,
  );
});

test("the chart repositories are each distinct parent path of a chart", () => {
  expect(chartRepositoryUrls(chartDeliveryValues(repository, lock()))).toEqual([
    "reg.example:5000/charts",
  ]);
});
