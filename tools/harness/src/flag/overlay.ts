import type { FileSystem } from "../runtime/index.js";

const ENVIRONMENTS = "infra/environments";

export class FlagError extends Error {}

export interface Overlay {
  environment: string;
  path: string;
  text: string;
  features: Record<string, boolean>;
}

function parse(path: string, text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Falls through to the actionable error below.
  }
  throw new FlagError(
    `${path} is not a JSON object; environment overlays stay JSON-compatible YAML. Fix the syntax, then rerun.`,
  );
}

function notADirectory(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
    return false;
  }
  throw error;
}

/** The environments that have an overlay, in name order. */
export async function environments(
  fs: FileSystem,
  root: string,
): Promise<string[]> {
  const names = await fs
    .readdir(`${root}/${ENVIRONMENTS}`)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new FlagError(
        `Cannot read ${ENVIRONMENTS} (${error instanceof Error ? error.message : String(error)}); fix its permissions, then rerun.`,
      );
    });
  const found: string[] = [];
  for (const name of [...names].sort()) {
    // A file beside the environment directories (schema.json) is not an environment.
    const overlay = `${root}/${ENVIRONMENTS}/${name}/environment.yaml`;
    if (await fs.exists(overlay).catch(notADirectory)) {
      found.push(name);
    }
  }
  return found;
}

export async function readOverlay(
  fs: FileSystem,
  root: string,
  environment: string,
): Promise<Overlay> {
  const path = `${ENVIRONMENTS}/${environment}/environment.yaml`;
  if (!(await environments(fs, root)).includes(environment)) {
    throw new FlagError(
      `No environment "${environment}" has an overlay at ${path}. Environments: ${(await environments(fs, root)).join(", ") || "none"}.`,
    );
  }
  const text = await fs.readFile(`${root}/${path}`);
  const features = parse(path, text)["features"] ?? {};
  const valid =
    typeof features === "object" &&
    features !== null &&
    Object.values(features).every((v) => typeof v === "boolean");
  if (!valid) {
    throw new FlagError(
      `${path} has a features map that is not flag name to boolean (ADR 0077). Fix it, then rerun.`,
    );
  }
  return {
    environment,
    path,
    text,
    features: features as Record<string, boolean>,
  };
}

/** The span of the `features` object's braces, or undefined when the overlay has none. */
function featuresSpan(text: string): [number, number] | undefined {
  const key = /["']?features["']?\s*:\s*\{/.exec(text);
  if (key === null) {
    return undefined;
  }
  const open = key.index + key[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return [open, i + 1];
    }
  }
  return undefined;
}

/** A flag entry written as false: optional quote, the whole name, the same quote, then the colon. */
const FALSE_ENTRY = /(["']?)([a-z][a-z0-9-]*)\1(\s*:\s*)false\b/g;

/** The overlay text with one flag set to true and every other byte unchanged. */
export function withFlagOn(overlay: Overlay, flag: string): string {
  const span = featuresSpan(overlay.text);
  const block = span === undefined ? "" : overlay.text.slice(...span);
  // Compares the captured key by string equality, so a flag named as a prefix of another never matches it.
  const entry = [...block.matchAll(FALSE_ENTRY)].find((m) => m[2] === flag);
  if (span === undefined || entry === undefined) {
    throw new FlagError(
      `${overlay.path} does not write ${flag} as false inside its features map, so the tool cannot edit it safely. Set it to false by hand, then rerun.`,
    );
  }
  const end = span[0] + entry.index + entry[0].length;
  const text = `${overlay.text.slice(0, end - "false".length)}true${overlay.text.slice(end)}`;
  parse(overlay.path, text);
  return text;
}
