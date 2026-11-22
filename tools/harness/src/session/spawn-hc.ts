import { join } from "node:path";
import type { CommandContext } from "../runtime/index.js";
import { fail, FAILED } from "./output.js";
import { admit } from "./spawn-hc-admit.js";
import { startSession } from "./spawn-hc-start.js";
import { startLedgerWatch } from "./spawn-hc-watch.js";

/** `session spawn` on hc: records the session, starts it as one hc run of the exec wrapper, then starts the ledger watch. It never waits: collect the result with session wait. */
export async function spawnHc(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const admitted = await admit(context);
  if ("error" in admitted) {
    return fail(deps, json, admitted.code, admitted.error);
  }
  const started = await startSession(deps, admitted);
  if ("error" in started) {
    return fail(deps, json, FAILED, started.error);
  }
  const { values } = admitted.requested;
  const { main } = admitted.reserved;
  await startLedgerWatch(deps, admitted.terminals, {
    bundle: join(main, "skills", "bin", "harness.mjs"),
    main,
    parent: admitted.parent.parent,
  });
  deps.stdout(
    json
      ? `${JSON.stringify({ name: values.name, terminal: started.terminal, model: values.model, role: values.role, effort: values.effort })}\n`
      : `Spawned ${values.name} (${values.model}) on hc terminal ${started.terminal}; collect its result with \`session wait ${values.name}\`.\n`,
  );
  return 0;
}
