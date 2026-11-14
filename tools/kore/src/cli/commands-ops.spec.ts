import { beforeEach, expect, test, vi } from "vitest";
import { opsReport } from "../ops/index.js";
import { opsCommand } from "./commands-ops.js";
import { stringFlag } from "./flags.js";
import { print } from "./output.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";

vi.mock("../ops/index.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository();
const runner = sharedRunner;

beforeEach(() => {
  vi.mocked(stringFlag).mockReturnValue(undefined);
  vi.mocked(opsReport).mockResolvedValue({
    report: { status: "valid" },
    ok: true,
  } as never);
});

test("ops hands the action, repository, runner and json to the report, and prints the report", async () => {
  const context = fakeContext({
    command: "ops",
    action: "inventory",
    repository,
    runner,
    json: true,
  });
  expect(await opsCommand(context)).toBe(0);
  expect(opsReport).toHaveBeenCalledWith("inventory", {
    repository,
    runner,
    json: true,
  });
  expect(print).toHaveBeenCalledWith({ status: "valid" }, true);
});

test("ops passes --from to the report only when it is given", async () => {
  vi.mocked(stringFlag).mockReturnValue("v1.2.0");
  const context = fakeContext({ command: "ops", action: "upgrade-check" });
  await opsCommand(context);
  expect(stringFlag).toHaveBeenCalledWith(context.parsed, "from");
  expect(opsReport).toHaveBeenCalledWith(
    "upgrade-check",
    expect.objectContaining({ from: "v1.2.0" }),
  );
});

test("ops leaves --from out of the report when no release is named", async () => {
  await opsCommand(
    fakeContext({ command: "ops", action: "recovery", parsed: parsedArgs() }),
  );
  expect(vi.mocked(opsReport).mock.calls[0]![1]).not.toHaveProperty("from");
});

test("ops exits 1 when the report lists problems, and still prints the report", async () => {
  vi.mocked(opsReport).mockResolvedValue({
    report: { status: "invalid" },
    ok: false,
  } as never);
  const context = fakeContext({ command: "ops", action: "crd-check" });
  expect(await opsCommand(context)).toBe(1);
  expect(print).toHaveBeenCalledWith({ status: "invalid" }, false);
});

test("ops is read-only: it never runs a mutation", async () => {
  const context = fakeContext({ command: "ops", action: "inventory" });
  await opsCommand(context);
  expect(context.mutate).not.toHaveBeenCalled();
});
