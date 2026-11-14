import { expect, test, vi } from "vitest";
import { type ActionHandler, mutateAction } from "./context.js";
import { fakeContext, fakeRunner } from "./cli-support.js";

test("mutateAction runs the handler named by the action inside the mutation, with the command as its default label", async () => {
  const runner = fakeRunner();
  const context = fakeContext({ command: "app", action: "up", runner });
  const up = vi.fn<ActionHandler>(async () => undefined);
  const result = await mutateAction(context, { up });
  expect(context.mutate).toHaveBeenCalledWith("app up", expect.any(Function));
  expect(up).toHaveBeenCalledWith(context, runner);
  expect(result).toBe(0);
});

test("mutateAction labels the mutation with the label it is given", async () => {
  const context = fakeContext({ command: "app", action: "up" });
  await mutateAction(context, { up: async () => undefined }, "app up web");
  expect(context.mutate).toHaveBeenCalledWith(
    "app up web",
    expect.any(Function),
  );
});

test("mutateAction runs no handler for an action the table does not name, and still reports success", async () => {
  const context = fakeContext({ command: "app", action: "restart" });
  const up = vi.fn<ActionHandler>(async () => undefined);
  expect(await mutateAction(context, { up })).toBe(0);
  expect(up).not.toHaveBeenCalled();
});

test("mutateAction reports 0 whatever the handler returns, because the handler reports through print", async () => {
  const context = fakeContext({ command: "trust", action: "install" });
  const result = await mutateAction(context, {
    install: async () => undefined,
  });
  expect(result).toBe(0);
});
