import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { NAME_VARIABLE, ROLE_VARIABLE } from "../sender/index.js";

const WRITER = "writer";
const PULL_REQUEST = /\/pull\/(\d+)\s*$/;
const NOT_RECORDED =
  "The pull request is open, but its link to the writer was not recorded";

/**
 * Records the pull request a writer opened as one pr.linked event, through the ledger's own
 * writer. Only a writer's spawn has a writer to link, so any other pane writes nothing. The
 * event carries the number and the session name from the spawn environment, and no text.
 * Returns the warning to print, or undefined when the link is written or none is due. A
 * ledger problem never blocks the pull request, which gh has already opened; an error that is
 * not a file error is a bug, and is rethrown.
 */
export async function linkPullRequest(
  deps: CliDeps,
  url: string,
): Promise<string | undefined> {
  if (deps.env[ROLE_VARIABLE] !== WRITER) {
    return undefined;
  }
  const name = deps.env[NAME_VARIABLE];
  const match = PULL_REQUEST.exec(url);
  if (match === null) {
    return `${NOT_RECORDED}: no pull request number in "${url}".`;
  }
  const main = await mainRoot(deps);
  if (main === undefined) {
    return `${NOT_RECORDED}: cannot find the main checkout to keep the ledger in.`;
  }
  try {
    const written = await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "herdr",
      kind: "pr.linked",
      occurredAt: deps.clock.now().toISOString(),
      number: Number(match[1]),
      session: name,
      agent: name,
    });
    return written.ok ? undefined : `${NOT_RECORDED}: ${written.message}`;
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
    return `${NOT_RECORDED}: ${(error as Error).message}`;
  }
}
