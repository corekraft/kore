import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { reasonOf } from "./preflight-message.js";
import { hostProblems } from "./preflight-host.js";

vi.mock("./preflight-message.js");

const vps: Repository = fakeRepository(
  { name: "vps", provider: "managed" },
  "/work/kore",
);

beforeEach(() => {
  vi.mocked(reasonOf).mockReturnValue("REASON");
});

const recap = (changed: number, unreachable = 0, failed = 0) =>
  `PLAY RECAP *********\nkore-vps                   : ok=18   changed=${changed}    unreachable=${unreachable}    failed=${failed}    skipped=3\n`;

test("a host whose check-mode run changes nothing, reaches the host and fails nothing has no missing prerequisite", async () => {
  const { runner } = fakeRunner(() => recap(0));
  expect(await hostProblems(vps, runner)).toEqual([]);
});

test("the check is the vps-check command: ansible-playbook in check mode with diff, in the host directory, captured, and never an apply", async () => {
  const { runner, run } = fakeRunner(() => recap(0));
  await hostProblems(vps, runner);
  expect(run).toHaveBeenCalledTimes(1);
  const [command, args, options] = run.mock.calls[0] ?? [];
  expect(command).toBe("ansible-playbook");
  expect(args).toEqual(["--check", "--diff", "site.yaml"]);
  expect(options).toMatchObject({
    cwd: "/work/kore/infra/hosts/vps",
    capture: true,
  });
});

test("a host the check would change is missing: the problem counts the changes, and the fix names the Ansible path", async () => {
  const { runner } = fakeRunner(() => recap(2));
  const [problem] = await hostProblems(vps, runner);
  expect(problem?.name).toBe("host check-mode diff");
  expect(problem?.problem).toContain("changed=2");
  expect(problem?.fix).toContain("mise run vps-check");
});

test("a host the check cannot reach is missing: unreachable or failed hosts are named as such", async () => {
  const unreachable = fakeRunner(() => recap(0, 1, 0)).runner;
  expect((await hostProblems(vps, unreachable))[0]?.problem).toContain(
    "unreachable=1",
  );
  const failed = fakeRunner(() => recap(0, 0, 3)).runner;
  expect((await hostProblems(vps, failed))[0]?.problem).toContain("failed=3");
});

test("a check-mode run that prints no recap for kore-vps is missing, not passed", async () => {
  const { runner } = fakeRunner(() => "PLAY RECAP\nother-host : ok=1\n");
  const [problem] = await hostProblems(vps, runner);
  expect(problem?.problem).toContain("no PLAY RECAP for kore-vps");
});

test("the captured diff is never echoed into the problem: a secret-shaped line in the output stays out of the message", async () => {
  const { runner } = fakeRunner(
    () => `+ seal_key: SECRET-DIFF-LINE\n${recap(1)}`,
  );
  const problems = await hostProblems(vps, runner);
  expect(JSON.stringify(problems)).not.toContain("SECRET-DIFF-LINE");
});

test("a check-mode run that cannot start is named as missing, with its reason, rather than thrown", async () => {
  const runner: Runner = {
    run: vi.fn(async () => {
      throw new Error("ansible-playbook: command not found");
    }),
  };
  const [problem] = await hostProblems(vps, runner);
  expect(problem?.name).toBe("host check-mode diff");
  expect(problem?.problem).toContain("REASON");
});
