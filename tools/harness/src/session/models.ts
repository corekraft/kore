/** A model as Claude Code's banner and status line name it, with a literal matcher for that name. */
interface KnownModel {
  name: string;
  /** Matches the name only when not part of a longer word or version, such as "Sonnet 5.55". */
  pattern: RegExp;
}

const MODELS: Readonly<Record<string, KnownModel>> = {
  "claude-fable-5-2": {
    name: "Fable 5.2",
    pattern: /(?<![\w.])Fable 5\.2(?![\w.])/,
  },
  "claude-opus-5-5": {
    name: "Opus 5.5",
    pattern: /(?<![\w.])Opus 5\.5(?![\w.])/,
  },
  "claude-sonnet-5-5": {
    name: "Sonnet 5.5",
    pattern: /(?<![\w.])Sonnet 5\.5(?![\w.])/,
  },
  "claude-haiku-5-5": {
    name: "Haiku 5.5",
    pattern: /(?<![\w.])Haiku 5\.5(?![\w.])/,
  },
};

export type ModelCheck =
  { status: "verified" } | { status: "unverified"; reason: string };

export type ScreenModel =
  | { status: "verified" }
  | { status: "mismatch"; seen: string }
  | { status: "none" };

/** The display name for a model ID, or undefined when the table does not know it. */
export function displayName(model: string): string | undefined {
  return Object.hasOwn(MODELS, model) ? MODELS[model]?.name : undefined;
}

/** Compares the model names on the pane's screen with the requested model's. */
export function modelOnScreen(model: string, screen: string): ScreenModel {
  const expected = Object.hasOwn(MODELS, model) ? MODELS[model] : undefined;
  if (expected?.pattern.test(screen) === true) {
    return { status: "verified" };
  }
  const seen = Object.values(MODELS).find(({ pattern }) =>
    pattern.test(screen),
  );
  return seen === undefined
    ? { status: "none" }
    : { status: "mismatch", seen: seen.name };
}
