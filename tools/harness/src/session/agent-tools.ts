import { parseDefinition } from "./agent-definition.js";

/** Tool names no prose uses as an ordinary word, so a bare mention names the tool. */
const DISTINCT = [
  "Monitor",
  "ToolSearch",
  "TaskStop",
  "Skill",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "SendMessage",
  "TodoWrite",
];

/** Tool names that are also ordinary words, so only a backticked mention names the tool. */
const COMMON = ["Agent", "Bash", "Edit", "Glob", "Grep", "Read", "Write"];

/**
 * The tools a definition's body sends the agent to that its `tools:` line
 * leaves out, in first-mention order. A definition with no `tools:` line
 * inherits every tool, so it names none that are missing.
 */
export function undeclaredTools(markdown: string): string[] {
  const { tools } = parseDefinition(markdown);
  if (tools === undefined) {
    return [];
  }
  const body = markdown.replace(/^---\n[\s\S]*?\n---/, "");
  const found = new Map<string, number>();
  const note = (name: string | undefined, at: number, known: string[]) => {
    if (name !== undefined && known.includes(name) && !found.has(name)) {
      found.set(name, at);
    }
  };
  for (const word of body.matchAll(/[A-Za-z]+/g)) {
    note(word[0], word.index, DISTINCT);
  }
  for (const quoted of body.matchAll(/`([A-Za-z]+)`/g)) {
    note(quoted[1], quoted.index, [...DISTINCT, ...COMMON]);
  }
  return [...found]
    .filter(([name]) => !tools.includes(name))
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}
