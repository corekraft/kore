import { CommandError, type Runner } from "../runtime/index.js";

// Docs: AGENTS.md "Pin everything."

export interface BuildInputs {
  /** Each base image as `name@digest`. */
  bases: string[];
  /** The platform the docker daemon builds for, as `os/arch`. */
  platform: string;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;

/** Registry commands fail for the network or the tool; a bug is not one of them. */
async function answer(
  runner: Runner,
  args: string[],
): Promise<string | undefined> {
  try {
    return (await runner.run("docker", args, { capture: true })).stdout.trim();
  } catch (error) {
    if (error instanceof CommandError) {
      return undefined;
    }
    throw error;
  }
}

function basesOf(dockerfile: string): string[] | undefined {
  const bases: string[] = [];
  const stages = new Set<string>();
  for (const line of dockerfile.split("\n")) {
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(
      line,
    );
    if (from === null) {
      continue;
    }
    const reference = from[1]!;
    if (reference.includes("$")) {
      return undefined; // a build argument decides it, which is not known here
    }
    if (reference.toLowerCase() !== "scratch" && !stages.has(reference)) {
      bases.push(reference);
    }
    if (from[2] !== undefined) {
      stages.add(from[2]);
    }
  }
  return bases;
}

/**
 * Resolves what the Dockerfile builds from. Returns undefined whenever any
 * of it is unknown, and the caller then builds rather than reuses an image.
 */
export async function resolveBuildInputs(
  runner: Runner,
  dockerfile: string,
): Promise<BuildInputs | undefined> {
  const references = basesOf(dockerfile);
  if (references === undefined || !/^\s*FROM\s/im.test(dockerfile)) {
    return undefined;
  }
  const bases: string[] = [];
  for (const reference of references) {
    if (/@sha256:[0-9a-f]{64}$/.test(reference)) {
      bases.push(reference);
      continue;
    }
    const digest = await answer(runner, [
      "buildx",
      "imagetools",
      "inspect",
      reference,
      "--format",
      "{{.Manifest.Digest}}",
    ]);
    if (digest === undefined || !digestPattern.test(digest)) {
      return undefined;
    }
    bases.push(`${reference}@${digest}`);
  }
  const platform = await answer(runner, [
    "version",
    "--format",
    "{{.Server.Os}}/{{.Server.Arch}}",
  ]);
  if (platform === undefined || !/^[a-z0-9]+\/[a-z0-9]+$/.test(platform)) {
    return undefined;
  }
  return { bases, platform };
}
