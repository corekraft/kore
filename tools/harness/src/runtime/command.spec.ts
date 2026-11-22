// command.ts declares types only, so there is no run-time behaviour to call. Its
// contract is a compile-time one: `tsc` (npm run check) fails when these shapes drift.
import { describe, expectTypeOf, it } from "vitest";
import type {
  CliDeps,
  Command,
  CommandContext,
  CommandEffects,
  CommandExample,
  CommandExit,
  CommandHelp,
} from "./command.js";

describe("the command types", () => {
  it("a command has a summary, optional flags and operand, a help record, and a run that resolves to an exit code", () => {
    expectTypeOf<Command["summary"]>().toEqualTypeOf<string>();
    expectTypeOf<Command["options"]>().toEqualTypeOf<
      Record<string, "string" | "boolean" | "list"> | undefined
    >();
    expectTypeOf<Command["operand"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Command["help"]>().toEqualTypeOf<CommandHelp>();
    expectTypeOf<Command["run"]>().returns.toEqualTypeOf<Promise<number>>();
  });

  it("a help record has purpose, when, whenNot, flag and operand descriptions, examples, exits, effects and related commands", () => {
    expectTypeOf<CommandHelp["purpose"]>().toEqualTypeOf<string>();
    expectTypeOf<CommandHelp["when"]>().toEqualTypeOf<string>();
    expectTypeOf<CommandHelp["whenNot"]>().toEqualTypeOf<string>();
    expectTypeOf<CommandHelp["flags"]>().toEqualTypeOf<
      Record<string, string>
    >();
    expectTypeOf<CommandHelp["operand"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CommandHelp["examples"]>().toEqualTypeOf<CommandExample[]>();
    expectTypeOf<CommandHelp["exits"]>().toEqualTypeOf<CommandExit[]>();
    expectTypeOf<CommandHelp["effects"]>().toEqualTypeOf<CommandEffects>();
    expectTypeOf<CommandHelp["seeAlso"]>().toEqualTypeOf<string[]>();
  });

  it("an example is a command line and what it shows; an exit is a code and its meaning; effects say read-only or mutates, with a detail", () => {
    expectTypeOf<CommandExample>().toEqualTypeOf<{
      command: string;
      shows: string;
    }>();
    expectTypeOf<CommandExit>().toEqualTypeOf<{
      code: number;
      meaning: string;
    }>();
    expectTypeOf<CommandEffects>().toEqualTypeOf<{
      kind: "read-only" | "mutates";
      detail: string;
    }>();
  });

  it("the context carries the json flag, the parsed options, an optional operand and the deps", () => {
    expectTypeOf<CommandContext["json"]>().toEqualTypeOf<boolean>();
    expectTypeOf<CommandContext["options"]>().toEqualTypeOf<
      Record<string, string | boolean>
    >();
    expectTypeOf<CommandContext["lists"]>().toEqualTypeOf<
      Record<string, string[]> | undefined
    >();
    expectTypeOf<CommandContext["operand"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<CommandContext["deps"]>().toEqualTypeOf<CliDeps>();
  });
});
