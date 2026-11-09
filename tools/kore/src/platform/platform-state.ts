import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";

export async function writePlatformState(
  repository: Repository,
  status: string,
): Promise<void> {
  const directory = join(repository.root, ".kore", "state");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${repository.environment.name}.json`),
    JSON.stringify(
      {
        environment: repository.environment.name,
        context: repository.environment.kubeContext,
        status,
        reconciledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
