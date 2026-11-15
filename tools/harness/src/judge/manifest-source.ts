import type { ChangedFile } from "./diff.js";
import { MANIFEST } from "./tooling.js";

/** Runs one `gh api` call with these arguments and returns its stdout. */
export type Api = (args: readonly string[]) => Promise<string>;

export interface ManifestSides {
  before: string;
  after: string;
}

const RAW = ["api", "-H", "Accept: application/vnd.github.raw"] as const;

/** The manifest at the merge base of the PR and at its head, read whole so a section header is never missing. */
export async function manifestSides(
  api: Api,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<ManifestSides> {
  const mergeBase = (
    await api([
      "api",
      `repos/${repo}/compare/${baseSha}...${headSha}`,
      "--jq",
      ".merge_base_commit.sha",
    ])
  ).trim();
  const before = await api([
    ...RAW,
    `repos/${repo}/contents/${MANIFEST}?ref=${mergeBase}`,
  ]);
  const after = await api([
    ...RAW,
    `repos/${repo}/contents/${MANIFEST}?ref=${headSha}`,
  ]);
  return { before, after };
}

const OVERLAY = /^infra\/environments\/[^/]+\/environment\.yaml$/;

/**
 * Attaches the manifest's sides to the diff's manifest entry, and the head text to each environment
 * overlay, whose hunk can start inside `features` with its opening line out of view. A deleted file has
 * no head text, so it is left bare.
 */
export async function withManifestSides(
  files: readonly ChangedFile[],
  api: Api,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<ChangedFile[]> {
  const touched = (f: ChangedFile) => f.path === MANIFEST && !f.deleted;
  const overlay = (f: ChangedFile) => OVERLAY.test(f.path) && !f.deleted;
  const sides = files.some(touched)
    ? await manifestSides(api, repo, baseSha, headSha)
    : undefined;
  return Promise.all(
    files.map(async (f) => {
      if (touched(f) && sides !== undefined) {
        return { ...f, sides };
      }
      if (overlay(f)) {
        const after = await api([
          ...RAW,
          `repos/${repo}/contents/${f.path}?ref=${headSha}`,
        ]);
        return { ...f, sides: { before: undefined, after } };
      }
      return f;
    }),
  );
}
