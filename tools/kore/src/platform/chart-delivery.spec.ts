// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  chartDeliveryValues,
  helmInstalledComponents,
} from "../config/index.js";
import { composeChartDelivery } from "./chart-delivery.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");

const repository = fakeRepository();
const values = {
  charts: {},
  namespaces: {},
  gatewayClassName: "istio",
  platformDomain: "kore.local",
};

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-config-delivery" }),
  ]);
  vi.mocked(readFile).mockResolvedValue('{"version":1,"entries":{}}');
  vi.mocked(chartDeliveryValues).mockReturnValue(values);
});

test("the repository gains the values composed from the lock file and the catalog", async () => {
  await expect(composeChartDelivery(repository, "lock.json")).resolves.toEqual({
    ...repository,
    chartDelivery: values,
  });
  expect(readFile).toHaveBeenCalledWith("lock.json", "utf8");
  expect(chartDeliveryValues).toHaveBeenCalledWith(repository, {
    version: 1,
    entries: {},
  });
});

test("with the flag off the repository is untouched and no file is read, even if a path is given", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([fakeComponent()]);
  await expect(composeChartDelivery(repository, "lock.json")).resolves.toBe(
    repository,
  );
  expect(readFile).not.toHaveBeenCalled();
});

test("a missing lock flag names the flag and the fix", async () => {
  await expect(composeChartDelivery(repository, undefined)).rejects.toThrow(
    "--platform-chart-lock <file> is required while platform-argocd-delivery is on in local; pass the platform-charts.lock.json attached to the release",
  );
});

test("an unreadable or non-JSON lock names the path and the fix", async () => {
  vi.mocked(readFile).mockResolvedValue("not json");
  await expect(composeChartDelivery(repository, "lock.json")).rejects.toThrow(
    /^--platform-chart-lock lock\.json must be the platform-charts\.lock\.json of a release: /,
  );
  expect(chartDeliveryValues).not.toHaveBeenCalled();
});

test("a lock that fails validation stops before any cluster call, with the errors", async () => {
  vi.mocked(chartDeliveryValues).mockImplementation(() => {
    throw new Error("platform chart lock: no entry for release opa-authorizer");
  });
  await expect(composeChartDelivery(repository, "lock.json")).rejects.toThrow(
    "platform chart lock: no entry for release opa-authorizer",
  );
});
