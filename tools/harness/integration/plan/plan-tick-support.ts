import { activePlan, planHarness } from "../../src/testing/index.js";

export const PLAN = "infra/plans/2-a.md";

export const BODY = `## Step 1: Alpha

- [ ] Wire the alpha gate
- [ ] Prove the beta path
      across two lines
- [x] Done already

## Step 2: Beta

- [ ] Ship the gamma release

## Where each open item can be done

Every item sits in one class (as of 2026-11-09: 2 local, 1 managed
cluster, 1 release pipeline).

### Local

- Step 1 (2): Wire the alpha gate (offline only); Prove the beta path
  across two lines.

### Managed cluster

- Step 2 (1): Ship the gamma release.

### Release pipeline and repository settings

- Step 1 (1): Tag it.

## Step 3: After

- [ ] Later
`;

export function plan(body = BODY) {
  return planHarness({ [PLAN]: activePlan(body) });
}
