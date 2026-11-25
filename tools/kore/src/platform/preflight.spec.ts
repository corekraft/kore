import { beforeEach, expect, test, vi } from "vitest";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { hostProblems } from "./preflight-host.js";
import { kubeProblems } from "./preflight-kube.js";
import { lockProblems } from "./preflight-locks.js";
import {
  renderMissing,
  type MissingPrerequisite,
} from "./preflight-message.js";
import { sopsProblems } from "./preflight-sops.js";
import { platformPreflight } from "./preflight.js";

vi.mock("./preflight-host.js");
vi.mock("./preflight-kube.js");
vi.mock("./preflight-locks.js");
vi.mock("./preflight-message.js");
vi.mock("./preflight-sops.js");

const vps = fakeRepository({ name: "vps", provider: "managed" });
const locks = { chartLock: "chart.json", templateLock: "template.json" };
const missing = (name: string): MissingPrerequisite => ({
  name,
  problem: `${name} is missing`,
  fix: `supply ${name}`,
});

beforeEach(() => {
  vi.mocked(sopsProblems).mockReturnValue([]);
  vi.mocked(lockProblems).mockResolvedValue([]);
  vi.mocked(kubeProblems).mockResolvedValue([]);
  vi.mocked(hostProblems).mockResolvedValue([]);
  vi.mocked(renderMissing).mockReturnValue("RENDERED");
});

test("an environment other than vps runs no preflight check, so its platform up is unchanged", async () => {
  const { runner, run } = fakeRunner();
  await platformPreflight(
    fakeRepository({ name: "local", provider: "k3d" }),
    runner,
    locks,
  );
  expect(sopsProblems).not.toHaveBeenCalled();
  expect(lockProblems).not.toHaveBeenCalled();
  expect(kubeProblems).not.toHaveBeenCalled();
  expect(hostProblems).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a vps run with every prerequisite present passes, and renders no refusal", async () => {
  const { runner } = fakeRunner();
  await expect(platformPreflight(vps, runner, locks)).resolves.toBeUndefined();
  expect(renderMissing).not.toHaveBeenCalled();
});

test("a vps run missing several prerequisites is refused with all of them in one message, not the first", async () => {
  vi.mocked(sopsProblems).mockReturnValue([missing("sops recipient")]);
  vi.mocked(lockProblems).mockResolvedValue([missing("release chart lock")]);
  vi.mocked(kubeProblems).mockResolvedValue([missing("tailnet reachability")]);
  vi.mocked(hostProblems).mockResolvedValue([missing("host check-mode diff")]);
  const { runner } = fakeRunner();
  await expect(platformPreflight(vps, runner, locks)).rejects.toThrow(
    "RENDERED",
  );
  expect(renderMissing).toHaveBeenCalledWith("vps", [
    missing("sops recipient"),
    missing("release chart lock"),
    missing("tailnet reachability"),
    missing("host check-mode diff"),
  ]);
});

test("every check runs even when an earlier one finds a prerequisite missing, so none is left unnamed", async () => {
  vi.mocked(sopsProblems).mockReturnValue([missing("sops recipient")]);
  const { runner } = fakeRunner();
  await expect(platformPreflight(vps, runner, locks)).rejects.toThrow();
  expect(lockProblems).toHaveBeenCalled();
  expect(kubeProblems).toHaveBeenCalled();
  expect(hostProblems).toHaveBeenCalled();
});

test("the locks checked are the two the run was given, and the cluster and host checks get this run's repository and runner", async () => {
  const { runner } = fakeRunner();
  await platformPreflight(vps, runner, locks);
  expect(lockProblems).toHaveBeenCalledWith(locks);
  expect(kubeProblems).toHaveBeenCalledWith(vps, runner);
  expect(hostProblems).toHaveBeenCalledWith(vps, runner);
});
