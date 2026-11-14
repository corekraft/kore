// Delta: what changed between a session's turns, as UserPromptSubmit context.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import type { DeltaDeps, Snapshot } from "../hook/index.js";

export const planText = (...items: string[]) =>
  `---\nstatus: active\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n## Step 1: Work\n\n${items.join("\n")}\n`;

export const entry = (op: string, kind: string, extra: object = {}) => ({
  ts: "2026-11-07T10:00:00.000Z",
  op,
  kind,
  ...extra,
});

export function fakeDeps(overrides: Partial<DeltaDeps> = {}) {
  const store = new Map<string, Snapshot>();
  const deps: DeltaDeps = {
    head: () => Promise.resolve("aaa1111"),
    branch: () => Promise.resolve("feat/x"),
    main: () => Promise.resolve("bbb2222"),
    commitsBetween: () => Promise.resolve([]),
    readPlans: () =>
      Promise.resolve({ "6-plan.md": planText("- [ ] Build it.") }),
    listLocks: () => Promise.resolve([]),
    readJournals: () => Promise.resolve({}),
    readSnapshot: (id) => Promise.resolve(store.get(id) ?? null),
    writeSnapshot: (id, snap) => {
      store.set(id, snap);
      return Promise.resolve();
    },
    now: () => 0,
    listSnapshots: () => Promise.resolve([]),
    removeSnapshot: () => Promise.resolve(),
    ...overrides,
  };
  return { store, deps };
}
