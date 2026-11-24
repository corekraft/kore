// The judge precheck's hostname claims (ADR 0159). A PR that changes a claim input is checked
// against main: kore validate runs over the merge of main and the PR, and the refusals are the
// messages the merge raises that main does not. A PR that touches hostnames must be up to date
// with main, because main's merge order is the claim order. A PR that changes no claim, or whose
// claims hold, is unaffected. The claim rules are kore's (validate reads them); this module only
// decides when a PR is checked and how its result reads.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import type { Runner } from "../runtime/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import { claimKind, fileAt, type ClaimKind } from "./hostname-claims-tree.js";
import {
  cliBuilt,
  KORE_CLI,
  validateRefusals,
} from "./hostname-claims-validate.js";
import type { Api } from "./manifest-source.js";

export interface HostnameClaimCheck {
  api: Api;
  runner: Runner;
  /** The judge's checkout, whose origin is the repository and whose build holds the kore CLI. */
  root: string;
  repo: string;
  /** The commit main is at now, which the PR's base branch names. */
  mainSha: string;
  /** The PR's head commit. */
  headSha: string;
  /** The PR's changed files, from the diff. */
  files: readonly ChangedFile[];
}

export interface HostnameClaimReport {
  /** Whether the PR changes a claim input: a hostname, a gateway, an organization, a reserved name or a platform domain. */
  touches: boolean;
  /** How many commits main has that the PR does not; a claim is checked against an up-to-date branch only. */
  behindBy: number;
  /** Each refusal names its file; empty when the PR is ready as far as its claims go. */
  refusals: string[];
}

/** A claim input the PR changes, at its path; gone when the PR removes it at this path. */
interface Change {
  path: string;
  kind: ClaimKind;
  gone: boolean;
}

interface CompareReply {
  behind_by?: number;
  merge_base_commit?: { sha?: string };
}

const staleMessage = (behindBy: number) =>
  `this PR touches hostnames and is ${behindBy} ${behindBy === 1 ? "commit" : "commits"} behind main: update from main (merge origin/main into this branch), then rerun the precheck; a claim is checked in main's merge order, so only an up-to-date branch can pass`;

const notBuiltMessage = (root: string) =>
  `the kore CLI is not built in ${root} (${KORE_CLI} is missing): build kore on the judge machine (npm run build in tools/kore), then rerun the precheck; the hostname claims cannot be checked without it`;

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a claim input says about the claims, so a change that keeps it is no touch. An
 * unreadable file says its own text, so a change to it still counts. An overlay's claims
 * depend on its platform domain and whether it declares an external Gateway.
 */
function projection(kind: ClaimKind, text: string | undefined): string {
  if (text === undefined) {
    return "absent";
  }
  if (kind === "reserved") {
    return text;
  }
  if (kind === "organization") {
    return "present";
  }
  const parsed = parseObject(text);
  if (parsed === undefined) {
    return `unreadable ${text}`;
  }
  if (kind === "service") {
    const spec = parsed["spec"] as Record<string, unknown> | undefined;
    return JSON.stringify({
      hostnames: spec?.["hostnames"],
      gateway: spec?.["gateway"],
      organization: spec?.["organization"],
    });
  }
  if (kind === "catalog") {
    const components = parsed["components"];
    return JSON.stringify(
      Array.isArray(components)
        ? components.map((c: Record<string, unknown>) => c["namespace"])
        : components,
    );
  }
  const platform = parsed["platform"] as Record<string, unknown> | undefined;
  return JSON.stringify({
    domain: platform?.["domain"],
    external:
      parsed["gateways"] !== undefined &&
      (parsed["gateways"] as Record<string, unknown>)["external"] !== undefined,
  });
}

/** The claim inputs a diff changes, the new path and the path a rename left. */
function changesOf(files: readonly ChangedFile[]): Change[] {
  return files.flatMap((file) => {
    const kind = claimKind(file.path);
    const before =
      file.previousPath === file.path
        ? undefined
        : claimKind(file.previousPath);
    return [
      ...(kind === undefined
        ? []
        : [{ path: file.path, kind, gone: file.deleted }]),
      ...(before === undefined
        ? []
        : [{ path: file.previousPath, kind: before, gone: true }]),
    ];
  });
}

/** Whether any changed claim input says something different at the merge base and at the head. */
async function changesClaims(
  api: Api,
  repo: string,
  mergeBase: string,
  headSha: string,
  changes: readonly Change[],
): Promise<boolean> {
  const differs = await Promise.all(
    changes.map(async (change) => {
      const before = projection(
        change.kind,
        await fileAt(api, repo, change.path, mergeBase),
      );
      const after = projection(
        change.kind,
        change.gone ? undefined : await fileAt(api, repo, change.path, headSha),
      );
      return before !== after;
    }),
  );
  return differs.some(Boolean);
}

/**
 * The hostname claims of one PR. A diff that changes no claim input makes no GitHub read
 * beyond the diff. A PR that touches a claim is refused while it is behind main, and its
 * merge with main is validated by kore, reporting only the messages main does not raise.
 * Without the built kore CLI a touching PR is refused, since its claims cannot be checked.
 */
export async function hostnameClaims(
  check: HostnameClaimCheck,
): Promise<HostnameClaimReport> {
  const { api, repo, mainSha, headSha, root } = check;
  const changes = changesOf(check.files);
  if (changes.length === 0) {
    return { touches: false, behindBy: 0, refusals: [] };
  }
  const compare = parseObject(
    await api(["api", `repos/${repo}/compare/${mainSha}...${headSha}`]),
  ) as CompareReply | undefined;
  const mergeBase = compare?.merge_base_commit?.sha;
  if (mergeBase === undefined) {
    throw new JudgeError(
      `gh api could not name the merge base of ${mainSha} and ${headSha}, so the hostname claims cannot be checked. Check \`gh auth status\`, then rerun the precheck.`,
    );
  }
  const behindBy = compare?.behind_by ?? 0;
  if (!(await changesClaims(api, repo, mergeBase, headSha, changes))) {
    return { touches: false, behindBy, refusals: [] };
  }
  const contested = (await cliBuilt(root))
    ? await validateRefusals({
        runner: check.runner,
        root,
        mainSha,
        headSha,
        files: check.files,
      })
    : [notBuiltMessage(root)];
  return {
    touches: true,
    behindBy,
    refusals: behindBy > 0 ? [staleMessage(behindBy), ...contested] : contested,
  };
}
