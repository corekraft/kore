import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
  type Repository,
} from "../../src/config/index.js";

// Helm renders of the platform-backstage chart, shared by its render specs.
const run = promisify(execFile);

// The flag decides whether the portal also attaches a route to the shared
// Gateway, so every render here states it off; the shared-on cases are in
// platform-backstage-shared-gateway.spec.ts.
export async function withFlagOff(environment: string): Promise<Repository> {
  const base = await loadRepository(environment);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "platform-shared-gateway": false,
      },
    },
  };
}

export async function renderWith(
  repository: Repository,
  extra: string[] = [],
): Promise<string> {
  const root = await findRoot();
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = [
    ...(component?.values ?? []),
    ...(repository.environment.componentValues?.["kore-platform-backstage"] ??
      []),
  ].flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
    ...extra,
  ]);
  return stdout;
}

export const document = (rendered: string, kind: string): string =>
  rendered
    .split(/^---$/m)
    .find((part) => new RegExp(`^kind: ${kind}$`, "m").test(part)) ?? "";
