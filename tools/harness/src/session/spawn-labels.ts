import type { Runner } from "../runtime/index.js";

/**
 * The label names the idea's issue carries right now, read through gh in the main
 * checkout. Only each label's name is kept: no title, body or colour leaves this
 * function. Returns undefined when the lookup did not work (gh failed or its reply
 * is not the shape expected), so the caller records none and the launch still starts.
 */
export async function issueLabels(
  runner: Runner,
  cwd: string,
  idea: string,
): Promise<string[] | undefined> {
  const done = await runner.run(
    "gh",
    ["issue", "view", idea.slice(1), "--json", "labels"],
    { cwd },
  );
  if (done.code !== 0) {
    return undefined;
  }
  let reply: unknown;
  try {
    reply = JSON.parse(done.stdout);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
  const labels = (reply as { labels?: unknown } | null)?.labels;
  if (!Array.isArray(labels)) {
    return undefined;
  }
  return labels.flatMap((entry: unknown) => {
    const name = (entry as { name?: unknown } | null)?.name;
    return typeof name === "string" ? [name] : [];
  });
}
