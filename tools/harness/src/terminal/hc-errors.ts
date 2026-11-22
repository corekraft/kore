import type { RunResult } from "../runtime/index.js";
import {
  terminalError,
  type TerminalError,
  type TerminalErrorKind,
} from "./port.js";

/** hc's error kinds that name a port kind. Any other kind is unavailable. */
const KINDS = new Map<string, TerminalErrorKind>([
  ["not_found", "not-found"],
  ["finished", "not-live"],
  ["live", "still-live"],
  ["name_taken", "name-taken"],
  ["status_mismatch", "status-mismatch"],
  ["invalid_params", "invalid-spec"],
]);

interface StructuredError {
  kind: string;
  message: string;
  hint?: string;
}

/** Maps a failed hc command to the port's error: hc's kind, message and hint when stderr has them. */
function isStructured(value: unknown): value is StructuredError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof value.kind === "string" &&
    typeof value.message === "string"
  );
}

/** hc's {error: {kind, message, hint}} from stderr, or undefined when stderr has none. */
function parseStructured(stderr: string): StructuredError | undefined {
  try {
    const parsed: unknown = JSON.parse(stderr);
    const error =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? parsed.error
        : undefined;
    return isStructured(error) ? error : undefined;
  } catch {
    return undefined;
  }
}

/** hc 0.1.21 prints its structured error on stdout; stderr is read too, for a build that prints it there. */
export function hcFailure(verb: string, result: RunResult): TerminalError {
  const structured =
    parseStructured(result.stdout) ?? parseStructured(result.stderr);
  if (structured !== undefined) {
    return terminalError(
      KINDS.get(structured.kind) ?? "unavailable",
      structured.message,
      structured.hint,
    );
  }
  return terminalError(
    "unavailable",
    "hc " +
      verb +
      " exited with code " +
      result.code +
      ": " +
      result.stderr.trim(),
  );
}
