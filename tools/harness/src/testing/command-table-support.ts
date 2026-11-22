// The harness command table the test fakes check documents and dispatch against: a few commands and their flags, so no unit spec loads every domain.
import type { CommandTable } from "../runtime/index.js";

export const HARNESS_COMMANDS: CommandTable = {
  pr: {
    open: { options: { title: "string", "body-file": "string" } },
    check: { options: { wait: "boolean" } },
  },
  plan: { tick: { options: {} } },
  flag: { activate: { options: { environment: "string" } } },
};
