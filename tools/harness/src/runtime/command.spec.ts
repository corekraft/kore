// command.ts declares types only, so there is no run-time behaviour to call. Its
// contract is a compile-time one: `tsc` (npm run check) fails when these shapes drift.
import { describe, expectTypeOf, it } from "vitest";
import type { CliDeps, Command, CommandContext } from "./command.js";

describe("the command types", () => {
  it("a command has a summary, optional flags and operand, and a run that resolves to an exit code", () => {
    expectTypeOf<Command["summary"]>().toEqualTypeOf<string>();
    expectTypeOf<Command["options"]>().toEqualTypeOf<
      Record<string, "string" | "boolean"> | undefined
    >();
    expectTypeOf<Command["operand"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Command["run"]>().returns.toEqualTypeOf<Promise<number>>();
  });

  it("the context carries the json flag, the parsed options, an optional operand and the deps", () => {
    expectTypeOf<CommandContext["json"]>().toEqualTypeOf<boolean>();
    expectTypeOf<CommandContext["options"]>().toEqualTypeOf<
      Record<string, string | boolean>
    >();
    expectTypeOf<CommandContext["operand"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<CommandContext["deps"]>().toEqualTypeOf<CliDeps>();
  });
});
