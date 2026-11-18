import type { Kind } from "./schema-kinds.js";

const SPLIT_KINDS: readonly Kind[] = ["token.split"];

/** The same name rule every ledger name field follows (schema.ts NAME). */
const NAME = /^[\w.:/#@-]{1,128}$/;
const isName = (v: unknown) => typeof v === "string" && NAME.test(v);
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/**
 * The token.split reading's numbers: each prompt step's requests and tokens by kind, the
 * first request's prompt size, the largest prompt, and the requests over the compaction cap
 * (absent when no cap was set, never zero). A reading holds these and the model name, never text.
 */
export interface SplitOrigin {
  model: string;
  firstPrompt: number;
  largestPrompt: number;
  overCap?: number;
  lowRequests: number;
  lowInput: number;
  lowCacheWrite5m: number;
  lowCacheWrite1h: number;
  lowCacheRead: number;
  lowOutput: number;
  highRequests: number;
  highInput: number;
  highCacheWrite5m: number;
  highCacheWrite1h: number;
  highCacheRead: number;
  highOutput: number;
}

const COUNT_FIELDS: readonly (keyof Omit<SplitOrigin, "model" | "overCap">)[] =
  [
    "firstPrompt",
    "largestPrompt",
    "lowRequests",
    "lowInput",
    "lowCacheWrite5m",
    "lowCacheWrite1h",
    "lowCacheRead",
    "lowOutput",
    "highRequests",
    "highInput",
    "highCacheWrite5m",
    "highCacheWrite1h",
    "highCacheRead",
    "highOutput",
  ];

/** Every field of a token.split reading is required on that kind, and no other kind takes one. */
export const SPLIT_RULES = [
  {
    field: "model",
    check: isName,
    hint: "must be a model name of letters, digits or . _ : / # @ -",
    kinds: SPLIT_KINDS,
  },
  ...COUNT_FIELDS.map((field) => ({
    field,
    check: isCount,
    hint: "must be a whole number, 0 or more",
    kinds: SPLIT_KINDS,
  })),
  {
    field: "overCap",
    check: isCount,
    hint: "must be a whole number, 0 or more",
    kinds: SPLIT_KINDS,
    optional: true,
  },
] as const;
