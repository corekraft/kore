// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The policy document for the job's write-only credential. The box can create an
// object and nothing else: no read, no list, no delete, no retention change. It is
// rendered from the environment's bucket, and attached to the credential on the target.

export interface JobPolicy {
  Version: "2012-10-17";
  Statement: readonly JobPolicyStatement[];
}

interface JobPolicyStatement {
  Sid: string;
  Effect: "Allow" | "Deny";
  Action: readonly string[];
  Resource: readonly string[];
}

/** The rights an object keeps once written: deleting it, or changing how long it is kept. */
const NO_REMOVAL = [
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "s3:BypassGovernanceRetention",
  "s3:PutObjectRetention",
  "s3:PutObjectLegalHold",
] as const;

/**
 * The job's write-only policy for one environment's prefix in the bucket. The
 * explicit deny holds even when another policy attached to the credential grants
 * a removal right.
 */
export function backupJobPolicy(
  bucket: string,
  environment: string,
): JobPolicy {
  const resource = [`arn:aws:s3:::${bucket}/${environment}/*`];
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "WriteBackupsOnly",
        Effect: "Allow",
        Action: ["s3:PutObject"],
        Resource: resource,
      },
      {
        Sid: "NoDeleteNoRetentionChange",
        Effect: "Deny",
        Action: [...NO_REMOVAL],
        Resource: resource,
      },
    ],
  };
}
