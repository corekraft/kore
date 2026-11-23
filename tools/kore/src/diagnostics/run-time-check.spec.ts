// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  missingRunTimeValues,
  platformDomainOrigin,
  runTimeDomainErrors,
  runTimeFilePath,
  runTimeNeededBy,
  runTimeValues,
  RunTimeFileError,
} from "../config/index.js";
import type { Environment } from "../config/index.js";
import { runTimeChecks } from "./run-time-check.js";

// Factories name only what the check reads, so the real barrel never loads.
vi.mock("../config/index.js", () => ({
  platformDomainVariable: "KORE_PLATFORM_DOMAIN",
  missingRunTimeValues: vi.fn(),
  platformDomainOrigin: vi.fn(),
  runTimeDomainErrors: vi.fn(),
  runTimeFilePath: vi.fn(),
  runTimeNeededBy: vi.fn(),
  runTimeValues: vi.fn(),
  RunTimeFileError: class extends Error {},
}));

const home = "/home/owner";
const path = "/home/owner/.kore/runtime.env";
const env: NodeJS.ProcessEnv = { KORE_PLATFORM_DOMAIN: "example.com" };
// A complete, valid environment, so each environment is typed without a cast. The check reads only the name and provider.
const base: Environment = {
  name: "local",
  provider: "k3d",
  kubeContext: "k3d-kore-local",
  registry: { address: "registry.example.com:5000" },
  platform: { domain: "example.com", organizationId: "kore" },
  gateway: { namespace: "gateway", name: "kore", port: 443 },
  secrets: { storeName: "kore", sourceNamespace: "secrets" },
  telemetry: { otlpEndpoint: "http://otel.example.com:4318" },
};
const managed: Environment = { ...base, name: "vps", provider: "managed" };
const local: Environment = base;
const load = vi.fn(async (_path: string) => undefined);

const domain = (checks: Awaited<ReturnType<typeof runTimeChecks>>) => checks[0];
const values = (checks: Awaited<ReturnType<typeof runTimeChecks>>) => checks[1];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTimeFilePath).mockReturnValue(path);
  vi.mocked(platformDomainOrigin).mockReturnValue("overlay");
  vi.mocked(runTimeDomainErrors).mockReturnValue([]);
  vi.mocked(runTimeNeededBy).mockReturnValue([]);
  vi.mocked(runTimeValues).mockReturnValue({});
  vi.mocked(missingRunTimeValues).mockReturnValue([]);
  load.mockResolvedValue(undefined);
});

test("a managed environment whose overlay placeholder is in force reports the domain as a placeholder warning that names the variable", async () => {
  expect(domain(await runTimeChecks(managed, {}, home, load))).toEqual({
    name: "platform-domain",
    status: "warn",
    required: false,
    message:
      "placeholder: the overlay's placeholder is in force; set KORE_PLATFORM_DOMAIN in the shell that runs kore to the platform domain",
  });
});

test("a run-time platform domain reports as set, naming only the variable and never the value", async () => {
  vi.mocked(platformDomainOrigin).mockReturnValue("run-time");
  const checks = await runTimeChecks(managed, env, home, load);
  expect(domain(checks)).toEqual({
    name: "platform-domain",
    status: "pass",
    required: false,
    message: "set: from KORE_PLATFORM_DOMAIN",
  });
  expect(JSON.stringify(checks)).not.toContain("example.com");
});

test("a malformed run-time platform domain fails the doctor, with the variable's refusal and its example", async () => {
  vi.mocked(platformDomainOrigin).mockReturnValue("run-time");
  const refusal =
    "KORE_PLATFORM_DOMAIN must be a lowercase DNS name of at least two labels, at most 180 characters, for example example.com; fix KORE_PLATFORM_DOMAIN in the shell that runs kore";
  vi.mocked(runTimeDomainErrors).mockReturnValue([refusal]);
  expect(domain(await runTimeChecks(managed, env, home, load))).toEqual({
    name: "platform-domain",
    status: "fail",
    required: true,
    message: `invalid: ${refusal}`,
  });
});

test("the local environment's domain is in its overlay, so it reports as set and warns about nothing", async () => {
  expect(domain(await runTimeChecks(local, {}, home, load))).toEqual({
    name: "platform-domain",
    status: "pass",
    required: false,
    message: "set: the local platform domain is in the environment overlay",
  });
});

test("with no flag that is on needing a run-time value, the values check passes and the file is never read", async () => {
  expect(values(await runTimeChecks(managed, {}, home, load))).toEqual({
    name: "run-time values",
    status: "pass",
    required: false,
    message: "no flag that is on needs a run-time value",
  });
  expect(load).not.toHaveBeenCalled();
});

test("a run-time file that another user can read is reported with the fix, and no value is read from it", async () => {
  const refusal = `${path} is readable by others; run chmod 600 ${path}, then retry`;
  vi.mocked(runTimeNeededBy).mockReturnValue([
    { flag: "tailnet-flag", name: "KORE_TAILNET_ADDRESS" },
  ]);
  vi.mocked(runTimeValues).mockImplementation(() => {
    throw new RunTimeFileError(refusal);
  });
  expect(values(await runTimeChecks(managed, {}, home, load))).toEqual({
    name: "run-time values",
    status: "warn",
    required: false,
    message: refusal,
  });
});

test("a flag that is on with a missing run-time value lists each missing value, its flag, and the file it can come from", async () => {
  vi.mocked(runTimeNeededBy).mockReturnValue([
    { flag: "tailnet-flag", name: "KORE_TAILNET_ADDRESS" },
  ]);
  vi.mocked(missingRunTimeValues).mockReturnValue([
    { flag: "tailnet-flag", name: "KORE_TAILNET_ADDRESS" },
  ]);
  expect(values(await runTimeChecks(managed, env, home, load))).toEqual({
    name: "run-time values",
    status: "warn",
    required: false,
    message: `missing run-time values: KORE_TAILNET_ADDRESS (for tailnet-flag); set each in the shell that runs kore or in ${path}`,
  });
  expect(load).toHaveBeenCalledWith(path);
});

test("when every value a flag that is on needs is set, the values check passes", async () => {
  vi.mocked(runTimeNeededBy).mockReturnValue([
    { flag: "tailnet-flag", name: "KORE_TAILNET_ADDRESS" },
  ]);
  expect(values(await runTimeChecks(managed, env, home, load))).toEqual({
    name: "run-time values",
    status: "pass",
    required: false,
    message: "every run-time value the flags that are on need is set",
  });
});

test("a run-time file that cannot be read for another reason is not swallowed", async () => {
  vi.mocked(runTimeNeededBy).mockReturnValue([
    { flag: "tailnet-flag", name: "KORE_TAILNET_ADDRESS" },
  ]);
  load.mockRejectedValue(new Error("EIO: input/output error"));
  await expect(runTimeChecks(managed, env, home, load)).rejects.toThrow("EIO");
});
