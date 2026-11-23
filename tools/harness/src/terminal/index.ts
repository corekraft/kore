export { terminalError } from "./port.js";
export type {
  Done,
  EventFilter,
  ListFilter,
  Output,
  RunSpec,
  SendOptions,
  Sent,
  Started,
  Status,
  Terminal,
  TerminalError,
  TerminalErrorKind,
  TerminalEvent,
  Terminals,
  Waited,
  WaitTarget,
} from "./port.js";
export { FakeTerminals } from "./FakeTerminals.js";
export { HcTerminals, type HcTerminalsOptions } from "./HcTerminals.js";
export { isInheritedFromCore } from "./inherited.js";
