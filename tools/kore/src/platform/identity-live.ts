import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner, type Runner } from "../runtime/index.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
// Live and opt-in: needs a running local profile with the `reference`
// application up (`kore local up`, `kore app up reference`). Identity and
// authorization checks only read pods, logs, and policy status. The one
// mutation, scaling the authorizer to zero, is restored in a `finally`. It
// never reads a Secret value: the credential it sends is a fixed fake string.
// Run it with `npm run test:integration:identity`.

export const namespace = "reference";
export const fakeCredential = "kore-identity-probe-credential-0000";

export const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 10 * 60 * 1000,
};

export async function setup(): Promise<{
  repository: Repository;
  runner: Runner;
}> {
  const repository = await loadRepository("local", await findRoot());
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);
  return { repository, runner };
}

export const kubectl = (
  repository: Repository,
  ...args: string[]
): string[] => ["--context", repository.environment.kubeContext, ...args];

export async function read(
  repository: Repository,
  runner: Runner,
  ...args: string[]
): Promise<string> {
  return (
    await runner.run("kubectl", kubectl(repository, ...args), { capture: true })
  ).stdout;
}

export const opaNamespace = (repository: Repository): string =>
  repository.catalog.components.find((c) => c.name === "opa-authorizer")
    ?.namespace ?? "opa-system";

// The authorizer runs several replicas and the protected request lands on any of
// them, so decision logs are read from all pods. A selector also defaults to the
// last 10 lines per pod, so the tail is unbounded. ADR 0066.
export const decisionLogArguments = (opaNamespaceName: string): string[] => [
  "--namespace",
  opaNamespaceName,
  "logs",
  "--selector=app.kubernetes.io/name=opa-authorizer",
  "--max-log-requests=10",
  "--tail=-1",
  "--since=2m",
];

export async function viaGateway(
  repository: Repository,
  runner: Runner,
  path: string,
  authorization?: string,
): Promise<number> {
  const { hostname, port } = repository.environment.gateway;
  const { stdout } = await runner.run(
    "curl",
    [
      "--insecure",
      "--silent",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--resolve",
      `${hostname}:${port}:127.0.0.1`,
      ...(authorization ? ["--header", `Authorization: ${authorization}`] : []),
      `https://${hostname}:${port}${path}`,
    ],
    { capture: true },
  );
  return Number(stdout.trim());
}

export type Constraint = { kind: string; name: string };

export async function constraints(
  repository: Repository,
): Promise<Constraint[]> {
  const dir = join(repository.root, "infra/policies/gatekeeper/constraints");
  return Promise.all(
    (await readdir(dir))
      .filter((f) => f.endsWith(".yaml"))
      .map(async (file) => {
        const text = await readFile(join(dir, file), "utf8");
        return {
          kind: /^kind:\s*(\S+)/m.exec(text)?.[1] ?? "",
          name: /^metadata:\s*\{\s*name:\s*([^\s,}]+)/m.exec(text)?.[1] ?? "",
        };
      }),
  );
}
