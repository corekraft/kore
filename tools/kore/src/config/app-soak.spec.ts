import { expect, test } from "vitest";
import { contractSoakVerdict, type SoakRecord } from "./app-soak.js";

const activatedAt = new Date("2026-11-24T10:00:00Z");
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

const judge = (
  overrides: {
    record?: SoakRecord | undefined;
    activatedAt?: Date | undefined;
    now?: Date;
    observedRequests?: number | undefined;
  } = {},
) =>
  contractSoakVerdict({
    record: overrides.record,
    activatedAt:
      "activatedAt" in overrides ? overrides.activatedAt : activatedAt,
    now: overrides.now ?? new Date(activatedAt.getTime() + hour),
    observedRequests: overrides.observedRequests,
  });

const after = (ms: number) => new Date(activatedAt.getTime() + ms);

test("a contract release inside the soak is refused, naming the time remaining", () => {
  const verdict = judge({ now: after(3 * hour) });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals).toHaveLength(1);
  expect(verdict.refusals[0]).toMatch(/21h/);
  expect(verdict.refusals[0]).toMatch(/2026-11-25T10:00:00\.000Z/);
});

test("a contract release is allowed once the soak window has passed", () => {
  const verdict = judge({ now: after(25 * hour) });

  expect(verdict.allowed).toBe(true);
  expect(verdict.refusals).toEqual([]);
});

test("a contract release is allowed at the exact end of the soak window", () => {
  const verdict = judge({ now: after(24 * hour) });

  expect(verdict.allowed).toBe(true);
});

test("a record without a soak is judged against the 24 hour default", () => {
  expect(judge({ now: after(23 * hour) }).allowed).toBe(false);
  expect(judge({ now: after(24 * hour) }).allowed).toBe(true);
  expect(judge({ record: undefined, now: after(23 * hour) }).allowed).toBe(
    false,
  );
});

test("a record that writes no minRequests does not judge the request count", () => {
  const verdict = judge({
    record: { duration: "1h" },
    now: after(2 * hour),
    observedRequests: undefined,
  });

  expect(verdict.allowed).toBe(true);
});

test("a soak under 30 minutes is accepted with an audit warning and never refused", () => {
  const verdict = judge({
    record: { duration: "10m" },
    now: after(11 * minute),
  });

  expect(verdict.allowed).toBe(true);
  expect(verdict.refusals).toEqual([]);
  expect(verdict.warnings).toHaveLength(1);
  expect(verdict.warnings[0]).toMatch(/10m/);
  expect(verdict.warnings[0]).toMatch(/30m/);
});

test("a soak of exactly 30 minutes raises no warning", () => {
  const verdict = judge({
    record: { duration: "30m" },
    now: after(31 * minute),
  });

  expect(verdict.warnings).toEqual([]);
});

test("a soak of 24 hours or more raises no warning", () => {
  expect(judge({ now: after(25 * hour) }).warnings).toEqual([]);
  expect(
    judge({ record: { duration: "7d" }, now: after(8 * 24 * hour) }).warnings,
  ).toEqual([]);
});

test("an afternoon soak written as hours is honoured as written", () => {
  expect(
    judge({ record: { duration: "4h" }, now: after(3 * hour) }).allowed,
  ).toBe(false);
  expect(
    judge({ record: { duration: "4h" }, now: after(4 * hour) }).allowed,
  ).toBe(true);
});

test("with minRequests set, a contract release is refused until enough requests are observed, naming how many are missing", () => {
  const verdict = judge({
    record: { duration: "1h", minRequests: 100 },
    now: after(2 * hour),
    observedRequests: 37,
  });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals).toHaveLength(1);
  expect(verdict.refusals[0]).toMatch(/63 more requests/);
  expect(verdict.refusals[0]).toMatch(/37 of 100/);
});

test("with minRequests set and met, a contract release after the window is allowed", () => {
  const verdict = judge({
    record: { duration: "1h", minRequests: 100 },
    now: after(2 * hour),
    observedRequests: 100,
  });

  expect(verdict.allowed).toBe(true);
});

test("with minRequests set, a soak whose time has not passed names both the time and the missing requests", () => {
  const verdict = judge({
    record: { duration: "24h", minRequests: 50 },
    now: after(1 * hour),
    observedRequests: 10,
  });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals.join("\n")).toMatch(/23h/);
  expect(verdict.refusals.join("\n")).toMatch(/40 more requests/);
});

test("with minRequests set and no request count recorded, the soak is refused and never assumed to pass", () => {
  const verdict = judge({
    record: { duration: "1h", minRequests: 100 },
    now: after(2 * hour),
    observedRequests: undefined,
  });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals[0]).toMatch(/request count/);
});

test("with no activation time recorded, the soak is refused and never assumed to have run", () => {
  const verdict = judge({ activatedAt: undefined, now: after(48 * hour) });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals[0]).toMatch(/activation/);
});

test("an activation time that is not a valid time is refused, not read as elapsed", () => {
  const verdict = judge({
    activatedAt: new Date("not a time"),
    now: after(48 * hour),
  });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals[0]).toMatch(/activation/);
});

test("a duration that is not a whole number of minutes, hours or days is refused, naming the accepted forms", () => {
  for (const duration of [
    "soon",
    "1.5h",
    "10s",
    "-1h",
    "0h",
    "",
    "24 h",
    "h24",
  ]) {
    const verdict = judge({ record: { duration }, now: after(100 * hour) });

    expect(verdict.allowed, duration).toBe(false);
    expect(verdict.refusals[0], duration).toMatch(/30m, 24h or 7d/);
  }
});

test("minRequests must be a whole number of at least one; omitting it turns the check off", () => {
  for (const minRequests of [0, -5, 1.5, Number.NaN]) {
    const verdict = judge({
      record: { duration: "1h", minRequests },
      now: after(2 * hour),
      observedRequests: 1000,
    });

    expect(verdict.allowed, String(minRequests)).toBe(false);
    expect(verdict.refusals[0], String(minRequests)).toMatch(/minRequests/);
  }
});

test("a malformed soak is refused on its own and never judged against a guessed duration", () => {
  const verdict = judge({
    record: { duration: "soon" },
    now: after(1000 * hour),
  });

  expect(verdict.allowed).toBe(false);
  expect(verdict.refusals).toHaveLength(1);
  expect(verdict.refusals[0]).toMatch(/soak\.duration/);
});

test("a release activated in the future is inside its soak, not past it", () => {
  const verdict = judge({ now: new Date(activatedAt.getTime() - hour) });

  expect(verdict.allowed).toBe(false);
});
