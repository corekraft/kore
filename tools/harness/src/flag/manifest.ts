import type { FileSystem } from "../runtime/index.js";
import { FlagError } from "./overlay.js";
import { FLAG_MANIFEST } from "./requirements.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** The kinds a manifest entry declares (ADR 0148). */
export type FlagKind = "feature" | "environment" | "harness";

/** One flag's entry in the manifest, with each optional mark defaulted (ADR 0148). */
export interface ManifestEntry {
  name: string;
  kind: FlagKind;
  applies: string[];
  requires: string[];
  pending: boolean;
  notApplicable: string[];
  reason?: string;
}

const KINDS: readonly string[] = ["feature", "environment", "harness"];

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** One manifest entry as the file holds it, read into the typed entry or refused as a whole. */
function entryOf(raw: unknown): ManifestEntry {
  const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const { name, kind, applies } = entry;
  if (
    typeof name !== "string" ||
    typeof kind !== "string" ||
    !KINDS.includes(kind) ||
    !isStringList(applies)
  ) {
    throw new FlagError(
      `${FLAG_MANIFEST} has an entry that does not name a flag, declare a kind of feature, environment or harness, and list the environments it applies to. Fix it, then rerun.`,
    );
  }
  if (entry["requires"] !== undefined && !isStringList(entry["requires"])) {
    throw new FlagError(
      `${FLAG_MANIFEST} requires of ${name} must be a list of flag names. Fix it, then rerun.`,
    );
  }
  return {
    name,
    kind: kind as FlagKind,
    applies,
    requires: (entry["requires"] as string[] | undefined) ?? [],
    pending: entry["pending"] === true,
    notApplicable: (entry["notApplicable"] as string[] | undefined) ?? [],
    ...(typeof entry["reason"] === "string" ? { reason: entry["reason"] } : {}),
  };
}

/** Reads the manifest's entries from its text, refusing a text that cannot be read whole (ADR 0148). */
export function parseManifest(text: string): ManifestEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FlagError(
      `${FLAG_MANIFEST} is not JSON-compatible YAML, so the progress report cannot read it. Fix the syntax, then rerun.`,
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
  return flags.map(entryOf);
}

/** Reads the manifest at the repository root; a manifest that cannot be read is refused by name (ADR 0148). */
export async function readManifest(
  fs: FileSystem,
  root: string,
): Promise<ManifestEntry[]> {
  const text = await fs
    .readFile(`${root}/${FLAG_MANIFEST}`)
    .catch((cause: unknown) => {
      throw new FlagError(
        `Cannot read ${FLAG_MANIFEST} (${cause instanceof Error ? cause.message : String(cause)}); the progress report reads the flag entries there. Restore the manifest, then rerun.`,
      );
    });
  return parseManifest(text);
}
