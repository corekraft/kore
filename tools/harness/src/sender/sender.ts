/**
 * The sender line: the first line of a comment or pane message, naming who wrote it. Its
 * text comes from the spawn environment, never from the agent, and a body with no such line
 * was written by the owner by hand. Writers and readers both go through this module, so the
 * format is defined once.
 */

/** The spawn environment's role, stamped by `session spawn`; unset in the main session. */
export const ROLE_VARIABLE = "KORE_ROLE";
/** The spawn environment's session name, stamped by `session spawn`. */
export const NAME_VARIABLE = "KORE_AGENT";
/** The sender a line names when the environment names no role. */
export const MAIN_SESSION = "the main session";

export interface SenderSession {
  readonly role: string;
  readonly name: string;
}

/** Who wrote a message and through which harness command. No session means the main session. */
export interface Sender {
  readonly command: string;
  readonly session?: SenderSession;
}

type Environment = Readonly<Record<string, string | undefined>>;

const ROLE = /^[a-z][a-z0-9-]*$/;
const NAME = /^[a-z0-9_-]+$/;
const LINE =
  /^sender: (?:the main session|([a-z][a-z0-9-]*) ([a-z0-9_-]+)) \(([^()\r\n]+)\)$/;

/**
 * The sender for `command`, read from the environment. A role with no usable session name is
 * refused rather than written as the main session, which would read as the owner's.
 */
export function senderFrom(
  env: Environment,
  command: string,
): Sender | { error: string } {
  const role = env[ROLE_VARIABLE] ?? "";
  const name = env[NAME_VARIABLE] ?? "";
  if (role === "") {
    return { command };
  }
  if (!ROLE.test(role)) {
    return {
      error: `${ROLE_VARIABLE} "${role}" is not a role name a sender line can carry: use lowercase letters, digits and "-", starting with a letter.`,
    };
  }
  if (name === "") {
    return {
      error: `${ROLE_VARIABLE} is "${role}" but ${NAME_VARIABLE} is not set, so the sender line cannot name the session. Spawn the session with \`harness session spawn\`, which sets both, then rerun.`,
    };
  }
  if (!NAME.test(name)) {
    return {
      error: `${NAME_VARIABLE} "${name}" is not a session name a sender line can carry: use lowercase letters, digits, "-" and "_".`,
    };
  }
  return { command, session: { role, name } };
}

/** The one line that names the sender, such as `sender: writer fix-x (review post)`. */
export function formatSender(sender: Sender): string {
  const who =
    sender.session === undefined
      ? MAIN_SESSION
      : `${sender.session.role} ${sender.session.name}`;
  return `sender: ${who} (${sender.command})`;
}

/** The sender a body's first line names, or undefined when it has no sender line. */
export function readSender(body: string): Sender | undefined {
  const first = (body.split("\n", 1)[0] ?? "").replace(/\r$/, "");
  const match = LINE.exec(first);
  if (match === null) {
    return undefined;
  }
  const [, role, name, command] = match;
  if (command === undefined) {
    return undefined;
  }
  return role === undefined || name === undefined
    ? { command }
    : { command, session: { role, name } };
}

/** The body without its first line when that line is a sender line; otherwise the body as it is. */
export function withoutSender(body: string): string {
  if (readSender(body) === undefined) {
    return body;
  }
  const newline = body.indexOf("\n");
  return newline === -1 ? "" : body.slice(newline + 1);
}
