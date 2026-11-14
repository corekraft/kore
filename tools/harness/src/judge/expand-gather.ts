import { readExpandStep } from "./expand-step.js";
import type { ExpandCheck } from "./expand-step-check.js";
import type { Api } from "./manifest-source.js";

/** The expand step a contract names, read through the caller's gh api. */
export function gatherExpandStep(args: {
  api: Api;
  pr: number;
  view: { headCommittedAt: string | undefined };
  reviewers: readonly string[];
  declared: { idea: string | undefined; expandStep: number };
}): Promise<ExpandCheck> {
  const { api, pr, view, reviewers, declared } = args;
  return readExpandStep(api, {
    pr,
    expandPr: declared.expandStep,
    idea: declared.idea,
    headCommittedAt: view.headCommittedAt,
    reviewers,
  });
}
