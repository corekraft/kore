import { beforeEach, expect, test, vi } from "vitest";
import {
  renderSizing,
  type SizedService,
  type SizingQuota,
} from "./app-sizing.js";
import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";

vi.mock("./quantity.js");

const quotaOf = (over: Partial<SizingQuota> = {}): SizingQuota => ({
  name: "team-a",
  file: "infra/environments/local/organizations/team-a.json",
  cpuMillis: 10_000,
  memoryMiB: 10_240,
  ephemeralMiB: 10_240,
  pods: 50,
  ...over,
});

const service = (
  components: SizedService["requests"],
  name = "leads",
): SizedService => ({
  file: `infra/environments/local/services/${name}.json`,
  name,
  requests: components,
});

const sized = {
  component: "frontend",
  cpu: "500m",
  memory: "512Mi",
  ephemeralStorage: "1Gi",
  memoryLimit: undefined,
  minReplicas: undefined,
  maxReplicas: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  const cpu: Record<string, number> = { "100m": 100, "500m": 500, "1": 1000 };
  const memory: Record<string, number> = {
    "512Mi": 512,
    "1Gi": 1024,
    "2Gi": 2048,
    "3Gi": 3072,
    "1024Mi": 1024,
  };
  vi.mocked(cpuMillis).mockImplementation((text) => cpu[text]);
  vi.mocked(memoryMiB).mockImplementation((text) => memory[text]);
  vi.mocked(formatCpu).mockImplementation((millis) => `${millis}m`);
  vi.mocked(formatMemory).mockImplementation((mib) => `${mib}Mi`);
});

test("a record that fits its suborg quota renders a ResourceQuota with the worst case and no errors", () => {
  const result = renderSizing(
    service([{ ...sized, maxReplicas: 5, minReplicas: 2 }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([]);
  expect(result.resourceQuota.hard).toEqual({
    "requests.cpu": "3000m",
    "requests.memory": "3072Mi",
    "requests.ephemeral-storage": "6144Mi",
    pods: "6",
  });
});

test("the rendered quota counts one surge pod above the maximum replicas", () => {
  const result = renderSizing(
    service([{ ...sized, maxReplicas: 3, minReplicas: 2 }]),
    quotaOf(),
  );
  expect(result.resourceQuota.hard.pods).toBe("4");
  expect(result.resourceQuota.hard["requests.memory"]).toBe("2048Mi");
});

test("an absent autoscaler renders the default minimum of two and maximum of five", () => {
  const result = renderSizing(service([sized]), quotaOf());
  expect(result.resourceQuota.hard.pods).toBe("6");
});

test("the LimitRange defaults the CPU request only, never the memory", () => {
  const result = renderSizing(service([sized]), quotaOf());
  expect(result.limitRange.limits).toEqual([
    { type: "Container", defaultRequest: { cpu: "100m" } },
  ]);
  expect(result.limitRange.limits[0]?.defaultRequest).not.toHaveProperty(
    "memory",
  );
});

test("a memory request that is missing is refused, naming the field, and nothing is defaulted", () => {
  const result = renderSizing(
    service([{ ...sized, memory: undefined }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([
    expect.stringContaining(
      "infra/environments/local/services/leads.json.spec.components.frontend.resources.requests.memory",
    ),
  ]);
  expect(result.errors[0]).toContain("a memory request is required");
});

test("an ephemeral storage request that is missing is refused, naming the field", () => {
  const result = renderSizing(
    service([{ ...sized, ephemeralStorage: undefined }]),
    quotaOf(),
  );
  expect(result.errors[0]).toContain(
    "resources.requests.ephemeralStorage: an ephemeral storage request is required",
  );
});

test("an ephemeral storage request that cannot be read is refused, naming the field and the form it takes", () => {
  const result = renderSizing(
    service([{ ...sized, ephemeralStorage: "lots" }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([
    expect.stringContaining(
      "resources.requests.ephemeralStorage: must be a memory quantity such as 1Gi or 512Mi",
    ),
  ]);
});

test("a memory limit that differs from the memory request is refused, naming both", () => {
  const result = renderSizing(
    service([{ ...sized, memoryLimit: "1Gi" }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([
    expect.stringContaining(
      "resources.limits.memory: 1Gi must equal the memory request 512Mi",
    ),
  ]);
});

test("a memory limit equal to the memory request is accepted", () => {
  const result = renderSizing(
    service([{ ...sized, memoryLimit: "512Mi" }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([]);
});

test("a minimum below two is refused, naming the field and the floor", () => {
  const result = renderSizing(
    service([{ ...sized, minReplicas: 1, maxReplicas: 5 }]),
    quotaOf(),
  );
  expect(result.errors[0]).toContain(
    "autoscaling.minReplicas: must be at least 2",
  );
});

test("a maximum below the minimum is refused, naming both", () => {
  const result = renderSizing(
    service([{ ...sized, minReplicas: 4, maxReplicas: 3 }]),
    quotaOf(),
  );
  expect(result.errors[0]).toContain(
    "autoscaling.maxReplicas: 3 is below minReplicas 4",
  );
});

test("a worst case over the suborg quota is refused, naming each dimension, the quota and the file to raise", () => {
  const result = renderSizing(
    service([{ ...sized, maxReplicas: 5, minReplicas: 2 }]),
    quotaOf({ memoryMiB: 2048, pods: 5 }),
  );
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("exceeds the quota of suborg team-a");
  expect(result.errors[0]).toContain("memory 3072Mi requested, quota 2048Mi");
  expect(result.errors[0]).toContain("pods 6 requested, quota 5");
  expect(result.errors[0]).toContain(
    "infra/environments/local/organizations/team-a.json",
  );
});

test("a worst case equal to the suborg quota fits", () => {
  const result = renderSizing(
    service([{ ...sized, maxReplicas: 5, minReplicas: 2 }]),
    quotaOf({ memoryMiB: 3072, pods: 6 }),
  );
  expect(result.errors).toEqual([]);
});

test("without a suborg quota, the record's own fields are still judged and no quota is compared", () => {
  const result = renderSizing(
    service([{ ...sized, memory: undefined }]),
    undefined,
  );
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("a memory request is required");
});

test("without a suborg quota a record that fits its own fields has no errors", () => {
  const result = renderSizing(service([sized]), undefined);
  expect(result.errors).toEqual([]);
});

test("a request the platform cannot read is left to the request form check, not judged as a sum", () => {
  const result = renderSizing(
    service([{ ...sized, memory: "lots" }]),
    quotaOf(),
  );
  expect(result.errors).toEqual([]);
  expect(result.resourceQuota.hard["requests.memory"]).toBeUndefined();
});

test("a component with no CPU request counts the LimitRange default in the worst case", () => {
  const result = renderSizing(
    service([{ ...sized, cpu: undefined, maxReplicas: 2, minReplicas: 2 }]),
    quotaOf(),
  );
  expect(result.resourceQuota.hard["requests.cpu"]).toBe("300m");
});
