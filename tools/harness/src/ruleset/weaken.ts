// What makes a ruleset weaker than another, shared by the guard hook (edits to
// the declared file) and by sync (a change on its way to the live main), so
// both call the same things a weakening (ADR 0090).

import type { Json } from "./declared.js";

const object = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Lists where growing the list loosens it: every merge method added is one more way past review. */
const LOOSENS_ON_GROWTH = [".allowed_merge_methods"];

/**
 * Where a value got weaker: a key or element gone, a number lowered, or a
 * value changed. A changed boolean or string cannot be told stricter from
 * different, so it counts; a new key or element, or a higher number, does not,
 * except in a list that loosens as it grows.
 */
export function weaker(was: unknown, now: unknown, path: string): string[] {
  if (Array.isArray(was)) {
    const kept = Array.isArray(now) ? (now as unknown[]) : [];
    const absent = (list: unknown[], item: unknown) =>
      !list.some((k) => same(k, item));
    if (LOOSENS_ON_GROWTH.some((suffix) => path.endsWith(suffix))) {
      return kept
        .filter((item) => absent(was, item))
        .map(() => `${path} gains an entry`);
    }
    return was
      .filter((item) => absent(kept, item))
      .map(() => `${path} loses an entry`);
  }
  const old = object(was);
  if (old !== undefined) {
    const next = object(now) ?? {};
    return Object.entries(old).flatMap(([key, value]) =>
      key in next
        ? weaker(value, next[key], `${path}.${key}`)
        : [`${path}.${key} is removed`],
    );
  }
  if (typeof was === "number" && typeof now === "number") {
    return now < was ? [`${path} is lowered`] : [];
  }
  return same(was, now) ? [] : [`${path} changes`];
}

/** The fields a ruleset body holds that the repository declares; GitHub adds others (id, timestamps, links). */
export const RULESET_FIELDS = [
  "name",
  "target",
  "enforcement",
  "conditions",
  "rules",
  "bypass_actors",
];

/** The declared fields of a live ruleset, so what GitHub adds does not read as a change. */
export const declaredFields = (live: Json): Json =>
  Object.fromEntries(
    Object.entries(live).filter(([key]) => RULESET_FIELDS.includes(key)),
  );

/** Fields compared on their own terms; every other field, such as `target`, weakens by changing at all. */
const HANDLED = ["name", "enforcement", "rules", "conditions", "bypass_actors"];

const typed = (body: Json): Map<string, unknown> =>
  new Map(
    ((body["rules"] as Json[] | undefined) ?? []).map((r) => [
      String(r["type"]),
      r["parameters"] ?? null,
    ]),
  );

export interface Weakenings {
  /** Rule types the new body drops. */
  removed: string[];
  /** Parameters, conditions or bypass actors that got weaker. */
  weaker: string[];
}

/** Bypass modes from narrowest to widest; a mode GitHub leaves unset is `always`. */
const BYPASS_MODES = ["pull_request", "always"];

const modeRank = (actor: Json): number => {
  const mode = actor["bypass_mode"];
  const rank = BYPASS_MODES.indexOf(typeof mode === "string" ? mode : "always");
  return rank === -1 ? BYPASS_MODES.length : rank;
};

const actorKey = (actor: Json): string =>
  `${String(actor["actor_type"])}:${String(actor["actor_id"])}`;

/** Bypass actors the new body adds, or widens from `pull_request` to `always`; narrowing one is a tightening. */
function widenedBypass(previous: Json, after: Json): string[] {
  const list = (body: Json) =>
    (body["bypass_actors"] as Json[] | undefined) ?? [];
  const had = new Map(list(previous).map((a) => [actorKey(a), a]));
  return list(after).flatMap((actor) => {
    const was = had.get(actorKey(actor));
    if (was === undefined) {
      return ["bypass_actors gains an actor"];
    }
    return modeRank(actor) > modeRank(was)
      ? [`bypass_actors ${actorKey(actor)} bypass_mode widens`]
      : [];
  });
}

/** How the ruleset `after` is weaker than `previous`; empty when it is not. */
export function weakenings(previous: Json, after: Json): Weakenings {
  const now = typed(after);
  const removed: string[] = [];
  const params: string[] = [];
  for (const [type, parameters] of typed(previous)) {
    if (now.has(type)) {
      params.push(...weaker(parameters, now.get(type), type));
    } else {
      removed.push(type);
    }
  }
  const conditions = same(previous["conditions"], after["conditions"])
    ? []
    : ["conditions change"];
  const bypass = widenedBypass(previous, after);
  const others = [...new Set([...Object.keys(previous), ...Object.keys(after)])]
    .filter((key) => !HANDLED.includes(key))
    .filter((key) => !same(previous[key], after[key]))
    .map((key) => `${key} changes`);
  return { removed, weaker: [...params, ...conditions, ...bypass, ...others] };
}
