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
  const mentions = [
    ...DISTINCT.map((name) => ({ name, pattern: `\\b${name}\\b` })),
    ...COMMON.map((name) => ({ name, pattern: `\`${name}\`` })),
  ]
    .map(({ name, pattern }) => ({
      name,
      at: body.search(new RegExp(pattern)),
    }))
    .filter(({ name, at }) => at >= 0 && !tools.includes(name));
  return mentions.sort((a, b) => a.at - b.at).map(({ name }) => name);
}
