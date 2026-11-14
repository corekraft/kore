// Text fixtures for the context hook's integration specs: real AGENTS.md and plan text.

export const agents = `# AGENTS.md

## Platform

- **One owner per resource.** Every resource has exactly one
  desired-state owner.
- **Deploy what was verified.** Images by digest. _Audited: \`image-digest\`._
- **Secrets never touch disk.** Encrypt at rest.
  _Enforced: \`secret-path\`._

## Code

- **Errors are actionable.** Say what's wrong and how to fix it.
`;

export const plan = `# Plan

## Step 1: Done

- [x] Finished work.

## Step 2: Open

### Work

- [ ] **Bound output.** Cap hook output
  at 40 lines.
- [x] Done here.

### Exit Criteria

- [ ] A large report is bounded.
`;

export const handedOff = `# Plan

## Step 8: Earlier

- [ ] Confirm live.

## Step 9: Operator Load

Next: write the statusline tests, then
wire it into settings.

### Work

- [x] Brief.
- [ ] Statusline.

## Results

- Last retrospective: 2026-11-01
`;

export const fourSteps = `# Plan

## Step 1: Done

- [x] Finished.

## Step 2: Current

- [ ] Now.

## Step 3: Third

- [ ] Later.

## Step 4: Closed

- [x] Already done.

## Step 5: Fifth

- [ ] Later still.

## Step 6: Sixth

- [ ] Much later.

## Step 7: Seventh

- [ ] Beyond the horizon.
`;

export const frontmatter = (status: string) =>
  `---\nstatus: ${status}\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n`;
