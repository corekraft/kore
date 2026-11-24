// The app record check's base ref and yq: an existing service's organization is
// compared with origin/main (or --record-base), a check that cannot run is a warning
// or a named failure, and a missing yq names the pinned version to install. Real git
// and yq; the record rules are in app-records.spec.ts.
import { afterEach, expect, test } from "vitest";
import {
  dir,
  fixture,
  record,
  withoutYq,
  type Fixture,
} from "./app-records-support.js";

const made: Fixture[] = [];

async function repo(...args: Parameters<typeof fixture>): Promise<Fixture> {
  const created = await fixture(...args);
  made.push(created);
  return created;
}

afterEach(async () => {
  for (const created of made.splice(0)) {
    await created.remove();
  }
});

test("an organization that changes on an existing service fails, naming the service and both values", async () => {
  const f = await repo(
    { [`${dir}/leads.json`]: record("leads") },
    {
      base: {
        [`${dir}/leads.json`]: record("leads", { organization: "sales" }),
      },
    },
  );
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: organization is immutable: leads declares organization sales at origin/main but sets platform; a new suborg means a new service name (ADR 0166)`,
  ]);
});

test("a service absent at the base ref is new, so it passes the immutability check", async () => {
  const f = await repo(
    { [`${dir}/leads.json`]: record("leads") },
    { base: { [`${dir}/other.json`]: record("other") } },
  );
  expect(await f.check()).toEqual({ errors: [], warnings: [] });
});

test("a --record-base that does not resolve fails, naming the flag to fix", async () => {
  const f = await repo({ [`${dir}/leads.json`]: record("leads") });
  expect(await f.check({ recordBase: "no-such-ref" })).toEqual({
    errors: [
      "--record-base no-such-ref does not resolve to a commit; name a commit that exists in this repository, or drop the flag to compare against origin/main",
    ],
    warnings: [],
  });
});

test("when origin/main does not resolve, the immutability check is skipped with a warning, not a failure", async () => {
  const f = await repo(
    { [`${dir}/leads.json`]: record("leads") },
    { origin: false },
  );
  expect(await f.check()).toEqual({
    errors: [],
    warnings: [
      "the organization immutability check was not run: origin/main does not resolve (no git or no origin); pass --record-base <ref> to compare against another ref",
    ],
  });
});

test("an environment with no services directory has nothing to check, so it needs no yq and no base", async () => {
  const f = await repo({}, { origin: false });
  expect(await f.check({ runner: withoutYq })).toEqual({
    errors: [],
    warnings: [],
  });
});

test("without yq the check fails, naming the pinned version and the mise command that installs it", async () => {
  const f = await repo({ [`${dir}/leads.json`]: record("leads") });
  await expect(f.check({ runner: withoutYq })).rejects.toThrow(
    "install yq 4.54.2 with mise (mise install yq@4.54.2)",
  );
});
