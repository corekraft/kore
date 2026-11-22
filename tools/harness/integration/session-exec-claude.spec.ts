// Runs the installed claude's own --help, so a claude without a flag session exec passes fails here.
import { expect, it } from "vitest";
import { ProcessRunner } from "../src/runtime/index.js";
import { PASSED_FLAGS, namesFlag } from "../src/session/index.js";

it("runs the installed claude's --help, which names every flag session exec passes", async () => {
  const help = await new ProcessRunner().run("claude", ["--help"]);

  expect(help.code).toBe(0);
  expect(PASSED_FLAGS.filter((flag) => !namesFlag(help.stdout, flag))).toEqual(
    [],
  );
});
