import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { reasonOf } from "./preflight-message.js";
import { kubeProblems } from "./preflight-kube.js";

vi.mock("./preflight-message.js");

const vps: Repository = fakeRepository({
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
});

beforeEach(() => {
  vi.mocked(reasonOf).mockReturnValue("REASON");
});

test("a context that answers /readyz ok is reachable, and is read with one bounded GET", async () => {
  const { runner, run } = fakeRunner(() => "ok");
  expect(await kubeProblems(vps, runner)).toEqual([]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "kore-vps",
      "get",
      "--raw",
      "/readyz",
      "--request-timeout=10s",
    ],
    { capture: true },
  );
});

test("a context whose API server does not answer is named as unreachable over the tailnet, with the fix", async () => {
  const runner: Runner = {
    run: vi.fn(async () => {
      throw new Error(
        "Get https://100.64.0.7:6443/readyz: dial tcp 100.64.0.7:6443: i/o timeout\nmore detail",
      );
    }),
  };
  const [problem] = await kubeProblems(vps, runner);
  expect(problem?.name).toBe("tailnet reachability");
  expect(problem?.problem).toContain("kubectl --context kore-vps");
  expect(problem?.problem).toContain("REASON");
  expect(problem?.fix).toContain("tailnet");
});

test("the failure's reason is taken through the shared reason helper, so no API server address is copied in", async () => {
  const runner: Runner = {
    run: vi.fn(async () => {
      throw new Error("Get https://100.64.0.7:6443/readyz: i/o timeout");
    }),
  };
  await kubeProblems(vps, runner);
  expect(reasonOf).toHaveBeenCalledWith(
    new Error("Get https://100.64.0.7:6443/readyz: i/o timeout"),
  );
});

test("a context that replies something other than ok is refused with what it replied", async () => {
  const { runner } = fakeRunner(() => "not yet");
  const [problem] = await kubeProblems(vps, runner);
  expect(problem?.problem).toContain("not yet");
});
