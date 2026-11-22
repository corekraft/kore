// A valid help record for a fake command that must carry one. The help domain's own specs
// build the records they check; the fakes here only need one that passes the type.
import type { CommandHelp } from "../runtime/index.js";

export const stubHelp: CommandHelp = {
  purpose: "A stub command.",
  when: "In a test.",
  whenNot: "Outside a test.",
  flags: {},
  examples: [{ command: "harness stub", shows: "nothing" }],
  exits: [{ code: 0, meaning: "always" }],
  effects: { kind: "read-only", detail: "nothing" },
  seeAlso: [],
};
