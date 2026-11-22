// The Terminals contract over a real hc core (plan 16, Step 2). A release gate,
// never a commit gate: it starts its own scratch core under a scratch HC_SESSION
// and XDG dirs, and stops it. Skipped, with the reason named, when hc is not on PATH.
// Docs: infra/plans/16-hc-native-sessions.md, docs/operations/hc-pin.md.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  terminalContract,
  type ContractSubject,
} from "../../src/testing/index.js";
import {
  hcMissingReason,
  scratchCore,
  type ScratchCore,
} from "./hc-core-support.js";

const missing = await hcMissingReason();

/** Polls a read until the terminal shows the text, or names the text it never saw. */
async function until(
  core: ScratchCore,
  id: string,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const read = await core.terminals.read(id, 0);
    if ("error" in read) {
      throw new Error("read of " + id + " failed: " + read.error.message);
    }
    if (read.text.includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("terminal " + id + " never printed " + JSON.stringify(text));
}

if (missing !== undefined) {
  it.skip(missing, () => undefined);
} else {
  describe("the Terminals contract over a real hc core", () => {
    let core: ScratchCore;

    beforeAll(async () => {
      core = await scratchCore();
      await core.start();
    });

    afterEach(async () => {
      await core.reset();
    });

    afterAll(async () => {
      await core.dispose();
    });

    terminalContract((): ContractSubject => ({
      terminals: core.terminals,
      dir: core.dir,
      emit: async (id, text) => {
        const shown = text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
        const sent = await core.terminals.send(
          id,
          "printf '%b' '" + shown + "'",
        );
        if ("error" in sent) {
          throw new Error(sent.error.message);
        }
        await until(core, id, text);
      },
      finish: async (id, exitCode) => {
        const sent = await core.terminals.send(id, "exit " + exitCode);
        if ("error" in sent) {
          throw new Error(sent.error.message);
        }
        const ended = await core.terminals.wait({ terminal: id }, 10_000);
        expect("error" in ended).toBe(false);
      },
    }));
  });
}
