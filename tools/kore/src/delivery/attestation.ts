// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md
// The predicate shapes are documented in the eval command's usage text (cli/usage.ts).

export const PREDICATE_TYPES = {
  evalResult: "urn:kore:eval-result:v1",
  flagsManifest: "urn:kore:flags-manifest:v1",
  migrationPlan: "urn:kore:migration-plan:v1",
} as const;

const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
const SHA256_PREFIX = "sha256:";

export interface Statement {
  _type: string;
  subject: { name: string; digest: { sha256: string } }[];
  predicateType: string;
  predicate: unknown;
}

export interface StatementInput {
  predicateType: string;
  version: string;
  /** The image digest, as sha256:<64 hex>; the statement carries the hex alone. */
  digest: string;
  predicate: unknown;
}

/** An in-toto v1 statement whose subject is the candidate's image digest. */
export function statement(input: StatementInput): Statement {
  return {
    _type: STATEMENT_TYPE,
    subject: [
      {
        name: input.version,
        digest: { sha256: input.digest.slice(SHA256_PREFIX.length) },
      },
    ],
    predicateType: input.predicateType,
    predicate: input.predicate,
  };
}
