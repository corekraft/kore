// What one session shows: guard blocks and warnings, failed tools, skills
// loaded, correction phrases, and what the agent did after each warning.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import {
  blocksOf,
  callSignature,
  humanText,
  isOrchestratorBrief,
  ownWords,
  phrasesOf,
  readsAsCorrection,
  resultText,
  summarizeError,
  type Block,
  type Transcript,
  type TranscriptEvent,
} from "./retro-transcript.js";

const GUARD_TAG = /\[guard:([a-z0-9-]+)\]/g;
const SLASH_COMMAND = /<command-name>\/?([a-z0-9:-]+)<\/command-name>/;

type Ordered =
  | { kind: "call"; id: string; name: string; signature: string }
  | { kind: "human" };

export interface Warning {
  rule: string;
  toolUseId: string | undefined;
  /** The transcript line of the warning's attachment. */
  line: number;
  /** The first line of the warned call's command, or its tool name when it has none. */
  excerpt: string;
}

const MAX_EXCERPT = 120;

/** What a warned call was doing: its command's first line, capped, else its tool name. */
const excerptOf = (
  name: string,
  input: Record<string, unknown> = {},
): string => {
  const command = input["command"];
  if (typeof command !== "string") {
    return name;
  }
  return (command.split("\n")[0] ?? "").trim().slice(0, MAX_EXCERPT);
};

export interface GuardCounts {
  blocks: number;
  warnings: number;
}

export type Outcome = "heeded" | "repeated" | "overridden" | "unresolved";

/** One guard block: the rule, the transcript line of its blocked result, and a short excerpt of that result. */
export interface GuardBlock {
  rule: string;
  line: number;
  excerpt: string;
}

const tagsIn = (text: string): string[] =>
  [...text.matchAll(GUARD_TAG)].map((match) => match[1] ?? "");

/** Everything the scan keeps from one session. */
export class SessionAnalysis {
  readonly guards: Record<string, GuardCounts> = {};
  readonly failures: { tool: string; error: string }[] = [];
  readonly skills = new Set<string>();
  readonly slashCommands: string[] = [];
  readonly phrases: { phrase: string; line: number }[] = [];
  readonly warnings: Warning[] = [];
  readonly guardBlocks: GuardBlock[] = [];
  readonly ordered: Ordered[] = [];
  private readonly calls = new Map<string, string>();
  private readonly excerpts = new Map<string, string>();
  private failedSinceHuman = false;

  constructor(session: Transcript) {
    for (const event of session.events) {
      for (const block of blocksOf(event)) {
        this.block(event, block);
      }
      this.attachment(event);
      this.human(event);
      this.slash(event);
    }
  }

  private bump(rule: string, key: keyof GuardCounts): void {
    const counts = (this.guards[rule] ??= { blocks: 0, warnings: 0 });
    counts[key]++;
  }

  private block(event: TranscriptEvent, block: Block): void {
    if (event.type === "assistant" && block.type === "tool_use") {
      this.toolUse(block);
    } else if (
      event.type === "user" &&
      block.type === "tool_result" &&
      block.is_error
    ) {
      this.toolFailure(event, block);
    }
  }

  private toolUse(block: Block): void {
    const id = block.id ?? "";
    const name = block.name ?? "";
    this.calls.set(id, name);
    this.excerpts.set(id, excerptOf(name, block.input));
    this.ordered.push({
      kind: "call",
      id,
      name,
      signature: callSignature(block.input),
    });
    const skill = block.input?.["skill"];
    if (name === "Skill" && typeof skill === "string" && skill) {
      this.skills.add(skill);
    }
  }

  private toolFailure(event: TranscriptEvent, block: Block): void {
    this.failedSinceHuman = true;
    const text = resultText(block);
    const tags = new Set(tagsIn(text));
    if (tags.size === 0) {
      this.failures.push({
        tool: this.calls.get(block.tool_use_id ?? "") ?? "unknown",
        error: summarizeError(text),
      });
    }
    for (const tag of tags) {
      this.bump(tag, "blocks");
      this.guardBlocks.push({
        rule: tag,
        line: event.line,
        excerpt: summarizeError(text),
      });
    }
  }

  private attachment(event: TranscriptEvent): void {
    const { attachment } = event;
    if (
      event.type !== "attachment" ||
      attachment?.type !== "hook_additional_context"
    ) {
      return;
    }
    const toolUseId = attachment.toolUseID;
    for (const rule of tagsIn([attachment.content].flat().join("\n"))) {
      this.bump(rule, "warnings");
      this.warnings.push({
        rule,
        toolUseId,
        line: event.line,
        excerpt: this.excerpts.get(toolUseId ?? "") ?? "",
      });
    }
  }

  private human(event: TranscriptEvent): void {
    const text = humanText(event);
    if (text === null) {
      return;
    }
    this.ordered.push({ kind: "human" });
    const own = ownWords(text);
    // Orchestrator briefs are pasted into many panes; they are never corrections.
    // A repeated prompt is only a correction if it reads like one or follows a failure.
    const brief = isOrchestratorBrief(text);
    if (!brief && (this.failedSinceHuman || readsAsCorrection(own))) {
      for (const phrase of phrasesOf(own)) {
        this.phrases.push({ phrase, line: event.line });
      }
    }
    this.failedSinceHuman = false;
  }

  private slash(event: TranscriptEvent): void {
    const content = event.message?.content;
    if (typeof content !== "string" || event.type !== "user") {
      return;
    }
    const match = SLASH_COMMAND.exec(content);
    if (match) {
      this.slashCommands.push(match[1] ?? "");
    }
  }

  /** What the agent did after one warning: heeded, repeated, overridden, or unresolved. */
  outcome(warning: Warning): Outcome {
    const call = this.ordered.findIndex(
      (item) => item.kind === "call" && item.id === warning.toolUseId,
    );
    const warned = this.ordered[call];
    if (warned?.kind !== "call") {
      return "unresolved";
    }
    for (const item of this.ordered.slice(call + 1)) {
      if (item.kind === "human") {
        return "overridden";
      }
      if (item.name === warned.name) {
        return item.signature === warned.signature ? "repeated" : "heeded";
      }
    }
    return "unresolved";
  }
}
