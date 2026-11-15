import type { Kind } from "./schema.js";

const LAUNCH_KINDS: readonly Kind[] = ["session.launch"];

/** Where a launch's tier came from: the agent definition, a recorded escalation, or a caller's flag. */
export const TIER_SOURCES = ["definition", "escalation", "override"] as const;
export type TierSource = (typeof TIER_SOURCES)[number];

const REASON = /^[^\p{Cc}]{1,100}$/u;

/** Both fields are optional: a launch from before they existed reads as an unknown tier source. */
export const TIER_RULES = [
  {
    field: "tierSource",
    check: (v: unknown) => TIER_SOURCES.includes(v as TierSource),
    hint: `must be one of ${TIER_SOURCES.join(", ")}`,
    kinds: LAUNCH_KINDS,
    optional: true,
  },
  {
    field: "tierReason",
    check: (v: unknown) => typeof v === "string" && REASON.test(v),
    hint: "must be 1-100 characters with no control characters",
    kinds: LAUNCH_KINDS,
    optional: true,
  },
] as const;

/** Where a launch's tier came from, and the reason a caller gave for overriding it. */
export interface TierOrigin {
  tierSource: TierSource;
  tierReason?: string;
}
