import { beforeEach, expect, test, vi } from "vitest";
import { COMMANDS, isMutating } from "../src/cli/commands.js";
import { main } from "../src/cli/cli.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

test("ops is read-only: no action mutates, so none needs --environment", () => {
  const spec = COMMANDS.get("ops")!;
  expect(spec.mutations).toEqual([]);
  for (const action of [
    "inventory",
    "recovery",
    "upgrade-check",
    "crd-check",
  ]) {
    expect(isMutating(spec, action)).toBe(false);
  }
});

test("ops inventory --json prints the machine-readable report and exits 0 when pins are sound", async () => {
  const write = vi.spyOn(process.stdout, "write");
  expect(await main(["ops", "inventory", "--json"])).toBe(0);
  const report = JSON.parse(String(write.mock.calls[0]![0])) as {
    status: string;
    problems: string[];
    items: unknown[];
  };
  expect(report.status).toBe("valid");
  expect(report.problems).toEqual([]);
  expect(report.items.length).toBeGreaterThan(0);
});

test("ops recovery exits 0 when every stateful component has an objective", async () => {
  expect(await main(["ops", "recovery"])).toBe(0);
});

test("an unknown ops action fails with the supported actions", async () => {
  await expect(main(["ops", "nope"])).rejects.toThrow(
    /use inventory, recovery, upgrade-check, or crd-check/,
  );
});
