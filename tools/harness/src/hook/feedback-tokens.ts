import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "../runtime/index.js";

/** Where a session keeps its transcript position between stops. */
export const tokenStateFile = (session: unknown): string =>
  join(
    tmpdir(),
    `kore-tokens-${(typeof session === "string" ? session : "default").replace(/[^\w.-]/g, "_")}.json`,
  );

/**
 * Where a session's transcript has been read to, kept between stops so each
 * stop reads only what is new. `lastId` and `lastTokens` let a message whose
 * later copy arrives after a stop (it repeats as it streams) replace its
 * earlier count instead of adding to it.
 */
export interface TokenState {
  /** Bytes of the transcript already counted, always at a line boundary. */
  offset: number;
  /** Tokens counted so far: input, output and cache-creation. */
  total: number;
  lastId?: string;
  lastTokens?: number;
}

export const EMPTY: TokenState = { offset: 0, total: 0 };

function usageOf(raw: string): { id?: string; tokens: number } | undefined {
  try {
    const value = JSON.parse(raw) as {
      type?: unknown;
      message?: { id?: unknown; usage?: Record<string, unknown> };
    };
    const usage = value.message?.usage;
    if (value.type !== "assistant" || usage === undefined) {
      return undefined;
    }
    const count = (key: string) => {
      const n = usage[key];
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
    };
    const id = value.message?.id;
    return {
      ...(typeof id === "string" ? { id } : {}),
      tokens:
        count("input_tokens") +
        count("output_tokens") +
        count("cache_creation_input_tokens"),
    };
  } catch {
    // A line that is not JSON carries no usage.
    return undefined;
  }
}

/**
 * Adds the complete lines of `text` (the transcript from `state.offset`) to the
 * running count. A half-written last line is left for the next stop. Cache
 * reads are left out, since they re-count the same context every turn. Only
 * numbers are kept; no text leaves this function.
 */
export function advance(state: TokenState, text: string): TokenState {
  const end = text.lastIndexOf("\n") + 1;
  let { total, lastId, lastTokens } = state;
  for (const raw of text.slice(0, end).split("\n")) {
    const usage = usageOf(raw);
    if (usage === undefined) {
      continue;
    }
    total +=
      usage.id !== undefined && usage.id === lastId
        ? usage.tokens - (lastTokens ?? 0)
        : usage.tokens;
    lastId = usage.id;
    lastTokens = usage.tokens;
  }
  return {
    offset: state.offset + Buffer.byteLength(text.slice(0, end)),
    total,
    ...(lastId === undefined ? {} : { lastId }),
    ...(lastTokens === undefined ? {} : { lastTokens }),
  };
}

function parseState(text: string): TokenState {
  try {
    const value = JSON.parse(text) as Partial<TokenState>;
    const { offset, total, lastId, lastTokens } = value;
    return typeof offset === "number" &&
      typeof total === "number" &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      total >= 0
      ? {
          offset,
          total,
          ...(typeof lastId === "string" ? { lastId } : {}),
          ...(typeof lastTokens === "number" ? { lastTokens } : {}),
        }
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * The session's tokens so far and whether they grew, reading the transcript only
 * from where the last stop stopped. A missing state file starts from the top, so
 * losing it costs one full read, not a wrong count. Best effort: an unreadable
 * transcript reports no growth.
 */
export async function readTokens(
  fs: FileSystem,
  path: unknown,
  stateFile: string,
): Promise<{ total: number; grew: boolean }> {
  try {
    if (typeof path !== "string" || path === "") {
      return { total: 0, grew: false };
    }
    const before = await fs.readFile(stateFile).then(parseState, () => EMPTY);
    const after = advance(before, await fs.readFrom(path, before.offset));
    if (after.offset !== before.offset) {
      await fs.writeFile(stateFile, JSON.stringify(after));
    }
    return { total: after.total, grew: after.total !== before.total };
  } catch {
    return { total: 0, grew: false };
  }
}
