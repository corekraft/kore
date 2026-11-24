import { beforeEach, expect, test, vi } from "vitest";
import { capacityFit, type CapacityFit } from "./capacity-fit.js";
import {
  crossFileRules,
  type ServiceFacts,
  type SuborgFacts,
} from "./cross-file-rules.js";
import { committedFraction, nodeBudget } from "./node-capacity.js";
import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";
import type { Environment } from "./types.js";

vi.mock("./capacity-fit.js");
vi.mock("./node-capacity.js");
vi.mock("./quantity.js");

const environment = { name: "local" } as Environment;
const dir = "infra/environments/local/organizations";
const serviceFile = (name: string) =>
  `infra/environments/local/services/${name}.json`;
const suborgFile = (name: string) => `${dir}/${name}.json`;

const service = (
  over: Partial<ServiceFacts> & { name: string },
): ServiceFacts => ({
  file: serviceFile(over.name),
  organization: "team-a",
  allowFrom: [],
  requests: [],
  ...over,
});

const suborg = (name: string, quota?: { cpu: string; memory: string }) => ({
  name,
  file: suborgFile(name),
  quota,
});

function rules(services: ServiceFacts[], suborgs: SuborgFacts[]) {
  return crossFileRules({
    environment,
    organizationsDirectory: dir,
    services,
    suborgs,
  });
}

const fits: CapacityFit = {
  status: "fits",
  platformSubtracted: false,
  headroom: { cpuMillis: 0, memoryMiB: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  const cpu: Record<string, number> = {
    "1": 1000,
    "2": 2000,
    "500m": 500,
    "1500m": 1500,
    "3500m": 3500,
  };
  const memory: Record<string, number> = {
    "512Mi": 512,
    "1Gi": 1024,
    "2Gi": 2048,
  };
  vi.mocked(cpuMillis).mockImplementation((text) => cpu[text]);
  vi.mocked(memoryMiB).mockImplementation((text) => memory[text]);
  vi.mocked(formatCpu).mockImplementation((millis) =>
    millis % 1000 === 0 ? String(millis / 1000) : `${millis}m`,
  );
  vi.mocked(formatMemory).mockImplementation((mib) =>
    mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`,
  );
  vi.mocked(nodeBudget).mockReturnValue({
    judged: true,
    nodes: 1,
    perNode: { cpuMillis: 4000, memoryMiB: 8192, diskGiB: 100 },
  });
  vi.mocked(committedFraction).mockReturnValue(0.8);
  vi.mocked(capacityFit).mockReturnValue(fits);
});

test("a service naming platform, the tenant root, needs no suborg record", () => {
  const report = rules(
    [service({ name: "checkout", organization: "platform" })],
    [],
  );
  expect(report.errors).toEqual([]);
});

test("a service naming a suborg the environment does not declare is refused, naming the file and the fix", () => {
  const report = rules(
    [service({ name: "checkout", organization: "team-z" })],
    [],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.organization: "team-z" is not a suborg of environment local: create ${suborgFile("team-z")}, or name an existing suborg (platform is the tenant root)`,
  ]);
});

test("a service naming a declared suborg passes the organization rule", () => {
  const report = rules(
    [service({ name: "checkout", organization: "team-a" })],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([]);
});

test("a grant written without its suborg is refused, naming the suborg the grantee is in", () => {
  const report = rules(
    [
      service({ name: "checkout", allowFrom: ["api"] }),
      service({ name: "api", organization: "platform" }),
    ],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.allowFrom: "api" does not name its grantee's suborg: write it as <suborg>/<service>, for example "platform/api"`,
  ]);
});

test("a grant that is not two names separated by one slash is refused with the form it must take", () => {
  const report = rules(
    [service({ name: "checkout", allowFrom: ["team-a/api/v2"] })],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.allowFrom: "team-a/api/v2" must name its grantee as <suborg>/<service>, both DNS labels`,
  ]);
});

test("a service granting itself is refused", () => {
  const report = rules(
    [service({ name: "checkout", allowFrom: ["team-a/checkout"] })],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.allowFrom: "team-a/checkout" is this service: a service may not grant itself access; remove the entry`,
  ]);
});

test("a grant to a sibling in the same suborg is accepted", () => {
  const report = rules(
    [
      service({ name: "checkout", allowFrom: ["team-a/api"] }),
      service({ name: "api" }),
    ],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([]);
});

test("a grant to a service that was removed is refused, naming the entry", () => {
  const report = rules(
    [service({ name: "checkout", allowFrom: ["team-a/gone"] })],
    [suborg("team-a", { cpu: "2", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.allowFrom: "team-a/gone" is not a service of environment local in suborg team-a: a grant needs an existing service there; remove the entry if the service was removed`,
  ]);
});

test("a grant to a service that exists in another suborg names the suborg it is in", () => {
  const report = rules(
    [
      service({ name: "checkout", allowFrom: ["team-b/api"] }),
      service({ name: "api" }),
    ],
    [
      suborg("team-a", { cpu: "2", memory: "2Gi" }),
      suborg("team-b", { cpu: "2", memory: "2Gi" }),
    ],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.allowFrom: "team-b/api" is not a service of environment local in suborg team-b: a grant needs an existing service there; remove the entry if the service was removed, or write the suborg the service is in, which is team-a/api`,
  ]);
});

test("requests over the suborg quota are refused, naming each dimension, the quota and the file to raise", () => {
  const report = rules(
    [
      service({
        name: "checkout",
        requests: [
          { component: "frontend", cpu: "1500m", memory: "512Mi" },
          { component: "bff", cpu: "500m", memory: "512Mi" },
        ],
      }),
    ],
    [suborg("team-a", { cpu: "1", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.components: the requests of checkout exceed the quota of suborg team-a: cpu 2 requested, quota 1; lower the components' resources.requests or raise spec.quota in ${suborgFile("team-a")}`,
  ]);
});

test("requests equal to the suborg quota fit", () => {
  const report = rules(
    [
      service({
        name: "checkout",
        requests: [{ component: "frontend", cpu: "1", memory: "1Gi" }],
      }),
    ],
    [suborg("team-a", { cpu: "1", memory: "1Gi" })],
  );
  expect(report.errors).toEqual([]);
});

test("a request the platform cannot read is refused, naming its field and the form it takes", () => {
  const report = rules(
    [
      service({
        name: "checkout",
        requests: [{ component: "frontend", cpu: "two", memory: "512Mi" }],
      }),
    ],
    [suborg("team-a", { cpu: "1", memory: "2Gi" })],
  );
  expect(report.errors).toEqual([
    `${serviceFile("checkout")}.spec.components.frontend.resources.requests.cpu: must be a CPU quantity such as 500m or 1`,
  ]);
});

test("a component with no requests counts as zero, as declared", () => {
  const report = rules(
    [
      service({
        name: "checkout",
        requests: [
          { component: "frontend", cpu: undefined, memory: undefined },
        ],
      }),
    ],
    [suborg("team-a", { cpu: "1", memory: "1Gi" })],
  );
  expect(report.errors).toEqual([]);
});

test("a suborg whose quota cannot be read is left to its own record, not judged here", () => {
  const report = rules(
    [
      service({
        name: "checkout",
        requests: [{ component: "frontend", cpu: "2", memory: "1Gi" }],
      }),
    ],
    [suborg("team-a", { cpu: "bogus", memory: "1Gi" })],
  );
  expect(report.errors).toEqual([]);
  expect(capacityFit).not.toHaveBeenCalled();
});

test("with no suborg in the environment the capacity sum is not judged and nothing is warned", () => {
  const report = rules(
    [service({ name: "checkout", organization: "platform" })],
    [],
  );
  expect(capacityFit).not.toHaveBeenCalled();
  expect(report).toEqual({ errors: [], warnings: [] });
});

test("the suborg quotas are summed against the environment's budget, share and nodes", () => {
  rules(
    [],
    [
      suborg("team-a", { cpu: "1", memory: "1Gi" }),
      suborg("team-b", { cpu: "500m", memory: "512Mi" }),
    ],
  );
  expect(capacityFit).toHaveBeenCalledWith({
    quotas: [
      { cpuMillis: 1000, memoryMiB: 1024 },
      { cpuMillis: 500, memoryMiB: 512 },
    ],
    budget: expect.objectContaining({ judged: true }),
    committedFraction: 0.8,
  });
});

test("an unjudged capacity names the missing input in a warning and never fails the record", () => {
  vi.mocked(capacityFit).mockReturnValue({
    status: "unjudged",
    missing: ["environment.cluster"],
  });
  const report = rules([], [suborg("team-a", { cpu: "1", memory: "1Gi" })]);
  expect(report).toEqual({
    errors: [],
    warnings: [
      `${dir}: the suborg quotas are not checked against the capacity of environment local: environment.cluster is not declared (ADR 0152), so the sum is not judged`,
    ],
  });
});

test("a suborg quota sum over the committed share is refused, naming the request, the allowance and the fix", () => {
  vi.mocked(capacityFit).mockReturnValue({
    status: "over",
    over: [{ dimension: "cpu", requested: 3500, allowed: 3200 }],
    platformSubtracted: false,
  });
  const report = rules([], [suborg("team-a", { cpu: "3500m", memory: "1Gi" })]);
  expect(report.errors).toEqual([
    `${dir}: the suborg quotas together exceed what environment local can commit: cpu 3500m against 3200m (allocatable × 1 node × committedFraction 0.8); lower a suborg's spec.quota or declare more capacity (ADR 0152)`,
  ]);
});

test("a sum within the share passes with a warning that the platform's requests are not yet subtracted", () => {
  vi.mocked(capacityFit).mockReturnValue(fits);
  const report = rules([], [suborg("team-a", { cpu: "1", memory: "1Gi" })]);
  expect(report).toEqual({
    errors: [],
    warnings: [
      `${dir}: the suborg quotas fit the committed share of environment local's capacity, but the platform's pod requests are not yet subtracted, so the capacity budget is not fully judged (ADR 0152)`,
    ],
  });
});

test("a sum within the share with the platform's requests subtracted carries no such warning", () => {
  vi.mocked(capacityFit).mockReturnValue({
    status: "fits",
    platformSubtracted: true,
    headroom: { cpuMillis: 0, memoryMiB: 0 },
  });
  const report = rules([], [suborg("team-a", { cpu: "1", memory: "1Gi" })]);
  expect(report).toEqual({ errors: [], warnings: [] });
});
