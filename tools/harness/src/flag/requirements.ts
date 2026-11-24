import type { FileSystem } from "../runtime/index.js";
import { FlagError, type Overlay } from "./overlay.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** The flag manifest, JSON-compatible YAML, that declares each flag's requires (ADR 0148). */
export const FLAG_MANIFEST = "infra/catalog/flags.yaml";

/**
 * Refuses to turn a flag on unless the overlay declares it and every flag it
 * requires is on there, naming what is missing. A flag the overlay leaves out
 * counts as off. It writes nothing, so a refusal leaves the overlay unchanged
 * (ADR 0148).
 */
export function assertMayTurnOn(
  overlay: Overlay,
  flag: string,
  requires: readonly string[],
): void {
  if (!Object.hasOwn(overlay.features, flag)) {
    throw new FlagError(
      `${overlay.path} does not declare flag "${flag}". Declared: ${Object.keys(overlay.features).join(", ") || "none"}. Declare it as false first.`,
    );
  }
  const missing = requires.filter(
    (required) => overlay.features[required] !== true,
  );
  if (missing.length > 0) {
    throw new FlagError(
      `${flag} requires ${missing.join(", ")} on in ${overlay.environment}, but ${missing.length === 1 ? "it is" : "they are"} off in ${overlay.path}, so ${overlay.path} is unchanged. Activate ${missing.join(", ")} in ${overlay.environment} first with \`harness flag activate\`, then rerun.`,
    );
  }
}

/** One manifest entry as the file holds it, before its fields are checked. */
interface ManifestEntry {
  name?: unknown;
  requires?: unknown;
}

function entriesOf(text: string): ManifestEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FlagError(
      `${FLAG_MANIFEST} is not JSON-compatible YAML, so the requirements of a flag cannot be read. Fix the syntax, then rerun.`,
    );
  }
  const flags =
    typeof value === "object" && value !== null
      ? (value as { flags?: unknown }).flags
      : undefined;
  if (!Array.isArray(flags)) {
    throw new FlagError(
      `${FLAG_MANIFEST} must declare a flags list. Fix it, then rerun.`,
    );
  }
  return flags as ManifestEntry[];
}

/**
 * The flags a flag requires to be on first, read from the flag manifest. A flag
 * whose entry names no requires, or that the manifest does not declare, requires
 * none. A manifest that cannot be read or checked fails closed, so a broken
 * manifest never reads as requiring nothing (ADR 0148).
 */
export async function flagRequires(
  fs: FileSystem,
  root: string,
  flag: string,
): Promise<string[]> {
  const text = await fs
    .readFile(`${root}/${FLAG_MANIFEST}`)
    .catch((cause: unknown) => {
      throw new FlagError(
        `Cannot read ${FLAG_MANIFEST} (${cause instanceof Error ? cause.message : String(cause)}); flag activation reads the requirements there. Restore the manifest, then rerun.`,
      );
    });
  const requires = entriesOf(text).find((e) => e.name === flag)?.requires;
  if (requires === undefined) {
    return [];
  }
  if (
    !Array.isArray(requires) ||
    !requires.every((name) => typeof name === "string")
  ) {
    throw new FlagError(
      `${FLAG_MANIFEST} requires of ${flag} must be a list of flag names. Fix it, then rerun.`,
    );
  }
  return requires as string[];
}
