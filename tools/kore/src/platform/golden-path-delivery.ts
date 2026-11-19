import { readFile } from "node:fs/promises";
import {
  gatewayClassName,
  helmInstalledComponents,
  platformPlan,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

export const goldenPathDeliveryRelease = "kore-golden-path-delivery";
const images = ["static-frontend", "kotlin-bff"] as const;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const prefix = "template image lock:";

type Entry = { image?: unknown; digest?: unknown };

function templateImages(lock: unknown) {
  const entries = (lock as { entries?: Record<string, Entry> } | null)?.entries;
  const errors: string[] = [];
  const result: Record<string, { image: string; digest: string }> = {};
  for (const name of images) {
    const entry = entries?.[name];
    if (typeof entry?.image !== "string" || entry.image === "") {
      errors.push(
        `${prefix} ${name} needs an image; pass the template-images.lock.json of the release that published it`,
      );
    } else if (
      typeof entry.digest !== "string" ||
      !digestPattern.test(entry.digest)
    ) {
      errors.push(
        `${prefix} ${name} digest must be sha256:<64 hex>, never a tag; republish the release`,
      );
    } else {
      result[name] = { image: entry.image, digest: entry.digest };
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return result;
}

async function git(
  repository: Repository,
  runner: Runner,
  args: string[],
): Promise<string> {
  const { stdout } = await runner.run("git", args, {
    cwd: repository.root,
    capture: true,
  });
  return stdout.trim();
}

/**
 * Composes the kore-golden-path-delivery chart's values: the template image
 * digests from the release's template lock (deployed by digest, ADR 0045), the
 * commit the sync follows, and the environment's platform domain and
 * GatewayClass so each Service's host is reachable over HTTPS. Only while the
 * release is installed (the flag is on); otherwise the repository is returned
 * untouched and nothing is read.
 */
export async function composeGoldenPathDelivery(
  repository: Repository,
  runner: Runner,
  lockPath: string | undefined,
): Promise<Repository> {
  if (
    !helmInstalledComponents(repository, false).some(
      (component) => component.name === goldenPathDeliveryRelease,
    )
  ) {
    return repository;
  }
  if (lockPath === undefined) {
    throw new Error(
      `--platform-template-lock <file> is required while platform-argocd-delivery is on in ${repository.environment.name}; pass the template-images.lock.json attached to the release`,
    );
  }
  let lock: unknown;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    throw new Error(
      `--platform-template-lock ${lockPath} must be the template-images.lock.json of a release: ${String(error)}`,
    );
  }
  const templates = templateImages(lock);
  const repoURL = await git(repository, runner, [
    "remote",
    "get-url",
    "origin",
  ]);
  if (!repoURL.startsWith("https://")) {
    throw new Error(
      `the git origin ${repoURL} is not an https URL, which the golden-path ApplicationSet needs; set origin to the https URL of the repository`,
    );
  }
  return {
    ...repository,
    goldenPathDelivery: {
      repoURL,
      revision: await git(repository, runner, ["rev-parse", "HEAD"]),
      environment: repository.environment.name,
      templateImages: templates,
      ingress: {
        platformDomain: platformPlan(repository.environment).domain,
        gatewayClassName: gatewayClassName(repository.environment),
      },
      sharedGateway:
        repository.environment.features?.["platform-shared-gateway"] === true,
    },
  };
}
