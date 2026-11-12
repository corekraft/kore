/** The display names Claude Code's banner and status line use, by exact model ID. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "claude-fable-5-2": "Fable 5.2",
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

export type ModelCheck =
  { status: "verified" } | { status: "unverified"; reason: string };

export type ScreenModel =
  | { status: "verified" }
  | { status: "mismatch"; seen: string }
  | { status: "none" };

/** The display name for a model ID, or undefined when the table does not know it. */
export function displayName(model: string): string | undefined {
  return Object.hasOwn(DISPLAY_NAMES, model) ? DISPLAY_NAMES[model] : undefined;
}

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`).test(text);
}

/** Compares the model names on the pane's screen with the requested model's display name. */
export function modelOnScreen(expected: string, screen: string): ScreenModel {
  if (mentions(screen, expected)) {
    return { status: "verified" };
  }
  const seen = Object.values(DISPLAY_NAMES).find((name) =>
    mentions(screen, name),
  );
  return seen === undefined ? { status: "none" } : { status: "mismatch", seen };
}
