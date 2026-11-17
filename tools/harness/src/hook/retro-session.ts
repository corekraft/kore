// What one session shows: guard blocks and warnings, failed tools, skills
// loaded, correction phrases, and what the agent did after each warning.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { bareSends, type BareSend } from "./retro-bare.js";
import { mainCommand, type MainCommand } from "./retro-main.js";
import {
  blocksOf,
  briefSessionName,
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
  /** The unquoted glob the guard names in its message, or "" when it names none. */
  glob: string;
}

const MAX_EXCERPT = 120;

/** The main session's own figures in one session (#940): foreground poll milliseconds, pane-result reads, signed sends and raw sends. */
export interface MainFigures {
  pollMs: number;
  reads: number;
  signed: number;
  raw: number;
}

/** One Bash call the session made, with the figures its command shows and when it ran. */
interface MainCall {
  id: string;
  at: string | undefined;
  ended: string | undefined;
  background: boolean;
  sidechain: boolean;
  figures: MainCommand;
}

const NO_MAIN: MainFigures = { pollMs: 0, reads: 0, signed: 0, raw: 0 };

/** Milliseconds from a call to its result; zero when either time is missing, so a poll never guesses. */
function elapsedMs({ at, ended }: MainCall): number {
  if (at === undefined || ended === undefined) {
    return 0;
  }
  const ms = Date.parse(ended) - Date.parse(at);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** The figures of a session's own calls: a sidechain's calls are a subagent's, not the session's. */
function figuresOf(calls: MainCall[]): MainFigures {
  const own = calls.filter((call) => !call.sidechain);
  const checks = new Map<string, number>();
  for (const { figures } of own) {
    for (const pr of figures.prChecks) {
      checks.set(pr, (checks.get(pr) ?? 0) + 1);
    }
  }
  // A raw gh pr checks is a poll only when its pull request is checked again in the session.
  const isPoll = ({ figures }: MainCall) =>
    figures.loop || figures.prChecks.some((pr) => (checks.get(pr) ?? 0) >= 2);
  const total = (pick: (figures: MainCommand) => number) =>
    own.reduce((sum, call) => sum + pick(call.figures), 0);
  return {
    pollMs: own
      .filter((call) => !call.background && isPoll(call))
      .reduce((sum, call) => sum + elapsedMs(call), 0),
    reads: total((figures) => figures.reads),
    signed: total((figures) => figures.signed),
    raw: total((figures) => figures.raw),
  };
}

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

/** A bare-glob message names the glob it flags: "[guard:bare-glob] <glob> is an unquoted glob; ...". */
const GLOB_NAMED = /\[guard:([a-z0-9-]+)\] (\S+) is an unquoted glob;/g;

/** A block message leads with its own tag, after at most the hook error prefix; later tags are quoted command text. */
const LEADING_TAG =
  /^\s*(?:PreToolUse:\S+ hook (?:blocking )?error: [^\n]*?\]: )?\[guard:([a-z0-9-]+)\]/;

const tagsIn = (text: string): string[] =>
  [...text.matchAll(GUARD_TAG)].map((match) => match[1] ?? "");

/** Everything the scan keeps from one session. */
export class SessionAnalysis {
  readonly guards: Record<string, GuardCounts> = {};
  readonly failures: { tool: string; error: string }[] = [];
  readonly skills = new Set<string>();
  readonly slashCommands: string[] = [];
  /** The agent definition each in-process Agent call named, one entry per call. */
  readonly subagents: string[] = [];
  readonly phrases: { phrase: string; line: number }[] = [];
  readonly warnings: Warning[] = [];
  readonly guardBlocks: GuardBlock[] = [];
  readonly ordered: Ordered[] = [];
  /** Bare GitHub posts and pane sends the agent made with Bash, counted per command segment. */
  readonly bare: Record<BareSend, number> = { gh: 0, herdr: 0 };
  /** The main session's own figures; zeros for a role session, whose name a spawn brief gives. */
  readonly main: MainFigures;
  /** The session name its spawn brief names, or undefined when its first typed message is no brief. */
  sessionName: string | undefined = undefined;
  private namedAlready = false;
  private readonly mainCalls = new Map<string, MainCall>();
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
    this.main =
      this.sessionName === undefined
        ? figuresOf([...this.mainCalls.values()])
        : { ...NO_MAIN };
  }

  private bump(rule: string, key: keyof GuardCounts): void {
    const counts = (this.guards[rule] ??= { blocks: 0, warnings: 0 });
    counts[key]++;
  }

  private block(event: TranscriptEvent, block: Block): void {
    if (event.type === "assistant" && block.type === "tool_use") {
      this.toolUse(event, block);
    } else if (event.type === "user" && block.type === "tool_result") {
      this.toolResult(event, block);
      if (block.is_error) {
        this.toolFailure(event, block);
      }
    }
  }

  /** Stamps a Bash call's result time, so its duration is the time the call held the session. */
  private toolResult(event: TranscriptEvent, block: Block): void {
    const call = this.mainCalls.get(block.tool_use_id ?? "");
    if (call !== undefined) {
      call.ended = event.timestamp;
    }
  }

  private toolUse(event: TranscriptEvent, block: Block): void {
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
    const command = block.input?.["command"];
    if (name === "Bash" && typeof command === "string") {
      for (const send of bareSends(command)) {
        this.bare[send]++;
      }
      this.mainCalls.set(id, {
        id,
        at: event.timestamp,
        ended: undefined,
        background: block.input?.["run_in_background"] === true,
        sidechain: event.isSidechain === true,
        figures: mainCommand(command),
      });
    }
    const skill = block.input?.["skill"];
    if (name === "Skill" && typeof skill === "string" && skill) {
      this.skills.add(skill);
    }
    const agent = block.input?.["subagent_type"];
    if (name === "Agent" && typeof agent === "string" && agent) {
      this.subagents.push(agent);
    }
  }

  private toolFailure(event: TranscriptEvent, block: Block): void {
    this.failedSinceHuman = true;
    const text = resultText(block);
    const leading = LEADING_TAG.exec(text)?.[1];
    const tags = new Set(leading ? [leading] : []);
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
    const text = [attachment.content].flat().join("\n");
    const globs = new Map(
      [...text.matchAll(GLOB_NAMED)].map((match) => [
        match[1] ?? "",
        match[2] ?? "",
      ]),
    );
    for (const rule of tagsIn(text)) {
      this.bump(rule, "warnings");
      this.warnings.push({
        rule,
        toolUseId,
        line: event.line,
        excerpt: this.excerpts.get(toolUseId ?? "") ?? "",
        glob: globs.get(rule) ?? "",
      });
    }
  }

  private human(event: TranscriptEvent): void {
    const text = humanText(event);
    if (text === null) {
      return;
    }
    this.ordered.push({ kind: "human" });
    if (!this.namedAlready) {
      this.namedAlready = true;
      this.sessionName = briefSessionName(text);
    }
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
