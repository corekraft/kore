import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

// Docs: docs/decisions/0073-digest-required-admission.md
// Live specs authenticate to the reference API with the token held in the
// cluster Secret `reference-app`. The Secret is the owner of the value, so the
// helper reads that one key through kubectl, decodes it in memory, and never
// reads .kore/, writes a file, or puts the value in a message or log.

const namespace = "reference";
const secretName = "reference-app";
const key = "API_TOKEN";

export async function readReferenceApiToken(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  let encoded: string;
  try {
    encoded = (
      await runner.run(
        "kubectl",
        [
          "--context",
          repository.environment.kubeContext,
          "--namespace",
          namespace,
          "get",
          `secret/${secretName}`,
          `--output=jsonpath={.data.${key}}`,
        ],
        { capture: true },
      )
    ).stdout.trim();
  } catch (error) {
    if (error instanceof CommandError) {
      throw new Error(
        `cannot read ${key} from Secret ${namespace}/${secretName}: run \`kore app up reference\` so the Secret exists, then retry`,
        { cause: error },
      );
    }
    throw error;
  }
  const token = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      `Secret ${namespace}/${secretName} has an empty or malformed ${key}; run \`kore app up reference\` to regenerate it`,
    );
  }
  return token;
}
