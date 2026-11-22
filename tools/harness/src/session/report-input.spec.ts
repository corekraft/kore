import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { stdinOf, STDIN } from "./report-input.js";

const USAGE = "session report --outcome done|blocked";

/** Deps whose stdin holds this text; the stdin read is counted so a test can see whether it happened. */
function depsWith(text: string) {
  const stdin = vi.fn(() => Promise.resolve(text));
  return { deps: { stdin } as unknown as CliDeps, stdin };
}

describe("stdinOf reads stdin only for the flag that names it", () => {
  it("gives the text of stdin exactly when --summary is -", async () => {
    const { deps, stdin } = depsWith("VERDICT: none\nEND VERDICT\n");

    expect(await stdinOf(deps, true, undefined, USAGE)).toStrictEqual({
      text: "VERDICT: none\nEND VERDICT\n",
    });
    expect(stdin).toHaveBeenCalledExactlyOnceWith();
  });

  it("gives the text of stdin exactly when --plan is -", async () => {
    const { deps } = depsWith('{"stop":{"reason":"owner"}}\n');

    expect(await stdinOf(deps, false, STDIN, USAGE)).toStrictEqual({
      text: '{"stop":{"reason":"owner"}}\n',
    });
  });

  it("reads nothing and gives nothing when no flag names stdin", async () => {
    const { deps, stdin } = depsWith("ignored");

    expect(await stdinOf(deps, false, "plan.json", USAGE)).toBeUndefined();
    expect(stdin).not.toHaveBeenCalled();
  });

  it("refuses an empty stdin, naming the flag that read it and the usage", async () => {
    const { deps } = depsWith("  \n");

    expect(await stdinOf(deps, true, undefined, USAGE)).toStrictEqual({
      error: `--summary - read nothing on stdin: ${USAGE}.`,
    });
    expect(await stdinOf(deps, false, STDIN, USAGE)).toStrictEqual({
      error: `--plan - read nothing on stdin: ${USAGE}.`,
    });
  });
});
