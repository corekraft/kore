import { beforeEach, expect, test, vi } from "vitest";
import { renderSizing } from "./app-sizing.js";
import { capacityFit, type CapacityFit } from "./capacity-fit.js";
import {
  crossFileRules,
  type ComponentRequests,
  type ServiceFacts,
  type SuborgFacts,
} from "./cross-file-rules.js";
import { committedFraction, nodeBudget } from "./node-capacity.js";
import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";
import type { Environment } from "./types.js";

// The sizing wiring of crossFileRules: with the app-sizing flag on, a service is judged by its
// worst case through renderSizing, and the declared-requests check is not run beside it.
// The plain (flag off) rules are covered in cross-file-rules.spec.ts.

vi.mock("./app-sizing.js");
vi.mock("./capacity-fit.js");
vi.mock("./node-capacity.js");
vi.mock("./quantity.js");

const environment = { name: "local" } as Environment;
const dir = "infra/environments/local/organizations";
const serviceFile = (name: string) =>
  `infra/environments/local/services/${name}.json`;
const suborgFile = (name: string) => `${dir}/${name}.json`;

const fits: CapacityFit = {
  status: "fits",
  platformSubtracted: true,
  headroom: { cpuMillis: 0, memoryMiB: 0 },
};

const component = (
  over: Partial<ComponentRequests> = {},
): ComponentRequests => ({
  component: "frontend",
  cpu: "500m",
  memory: "512Mi",
  memoryLimit: undefined,
  ephemeralStorage: "1Gi",
  minReplicas: undefined,
  maxReplicas: undefined,
  ...over,
});

const leads = (requests: ComponentRequests[]): ServiceFacts => ({
  file: serviceFile("leads"),
  name: "leads",
  organization: "team-a",
  allowFrom: [],
  requests,
});

const teamA = (
  quota: SuborgFacts["quota"] = { cpu: "2", memory: "2Gi" },
): SuborgFacts => ({
  name: "team-a",
  file: suborgFile("team-a"),
  quota,
  pods: 10,
  storage: "10Gi",
});

const run = (
  services: ServiceFacts[],
  suborgs: SuborgFacts[],
  sizing: boolean,
) =>
  crossFileRules({
    environment,
    organizationsDirectory: dir,
    services,
    suborgs,
    sizing,
  });

beforeEach(() => {
  vi.clearAllMocks();
  const cpu: Record<string, number> = { "500m": 500, "2": 2000, "3": 3000 };
  const memory: Record<string, number> = {
    "512Mi": 512,
    "2Gi": 2048,
    "10Gi": 10240,
  };
  vi.mocked(cpuMillis).mockImplementation((text) => cpu[text]);
  vi.mocked(memoryMiB).mockImplementation((text) => memory[text]);
  vi.mocked(formatCpu).mockImplementation((millis) => `${millis}m`);
  vi.mocked(formatMemory).mockImplementation((mib) => `${mib}Mi`);
  vi.mocked(nodeBudget).mockReturnValue({
    judged: true,
    nodes: 1,
    perNode: { cpuMillis: 4000, memoryMiB: 8192, diskGiB: 100 },
  });
  vi.mocked(committedFraction).mockReturnValue(0.8);
  vi.mocked(capacityFit).mockReturnValue(fits);
  vi.mocked(renderSizing).mockReturnValue({
    resourceQuota: { hard: {} },
    limitRange: { limits: [] },
    errors: [],
  });
});

test("with the sizing flag off, the worst case is not rendered and the declared requests are the only quota check", () => {
  const report = run([leads([component({ cpu: "3" })])], [teamA()], false);
  expect(renderSizing).not.toHaveBeenCalled();
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0]).toContain("exceed the quota of suborg team-a");
});

test("with the sizing flag on, the service is judged by its worst case and its errors are reported once", () => {
  vi.mocked(renderSizing).mockReturnValue({
    resourceQuota: { hard: {} },
    limitRange: { limits: [] },
    errors: ["sizing: the worst case is over the quota"],
  });
  const report = run([leads([component({ cpu: "3" })])], [teamA()], true);
  expect(renderSizing).toHaveBeenCalledWith(
    expect.objectContaining({ name: "leads", file: serviceFile("leads") }),
    {
      name: "team-a",
      file: suborgFile("team-a"),
      cpuMillis: 2000,
      memoryMiB: 2048,
      ephemeralMiB: 10240,
      pods: 10,
    },
  );
  expect(report.errors).toEqual(["sizing: the worst case is over the quota"]);
});

test("with the sizing flag on and no suborg for the service, the record's own fields are judged with no quota", () => {
  run([{ ...leads([component()]), organization: undefined }], [], true);
  expect(renderSizing).toHaveBeenCalledWith(
    expect.objectContaining({ name: "leads" }),
    undefined,
  );
});

test("with the sizing flag on, a suborg whose quota cannot be read is passed to the judge with no quota", () => {
  run([leads([component()])], [{ ...teamA(), quota: undefined }], true);
  expect(renderSizing).toHaveBeenCalledWith(
    expect.objectContaining({ name: "leads" }),
    undefined,
  );
});

test("with the sizing flag on, the record's requests are still format-checked, naming the field", () => {
  const report = run([leads([component({ cpu: "lots" })])], [teamA()], true);
  expect(report.errors).toEqual([
    expect.stringContaining(
      `${serviceFile("leads")}.spec.components.frontend.resources.requests.cpu: must be a CPU quantity`,
    ),
  ]);
});
