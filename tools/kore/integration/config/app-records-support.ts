// Fixture repositories for the app record integration specs (app-records*.spec.ts).
// A fixture copies the chart's Service XRD and the ServiceRelease schema from this
// repository, so the check reads the same files that ship. Its git is real, and so
// is the yq the check runs, unless a spec passes withoutYq.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkAppRecords,
  type AppRecordCheck,
  type AppRecordReport,
} from "../../src/config/index.js";
import { ProcessRunner, type Runner } from "../../src/runtime/index.js";

export type Files = Record<string, string>;

export const dir = "infra/environments/local/services";
export const digest = `sha256:${"a".repeat(64)}`;
export const attestation = `ghcr.io/corekraft/kore/leads-attestation@sha256:${"c".repeat(64)}`;
export const commit = "b".repeat(40);
export const runner: Runner = new ProcessRunner();

const repository = new URL("../../../../", import.meta.url);
/** The files every fixture copies from this repository. */
const copied = [
  "infra/charts/platform-apis/templates/service-xrd.yaml",
  "infra/catalog/schemas/service-release.schema.json",
];

export interface Fixture {
  root: string;
  check(options?: Partial<AppRecordCheck>): Promise<AppRecordReport>;
  remove(): Promise<void>;
}

/** Under a git hook GIT_DIR names the real repository; the fixture's git must not see it. */
const withoutGit = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

/** A Service spec file: `frontend` only, unless overrides replace the fields. */
export function record(
  name: string,
  spec: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "Service",
      metadata: { name },
      spec: {
        organization: "platform",
        environments: ["local"],
        components: { frontend: {} },
        ...spec,
      },
    },
    null,
    2,
  );
}

/** A ServiceRelease file carrying the frontend digest, its attestation and the source commit. */
export function release(
  name: string,
  spec: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "ServiceRelease",
      metadata: { name },
      spec: {
        commit,
        components: { frontend: { digest, attestation } },
        ...spec,
      },
    },
    null,
    2,
  );
}

/**
 * A fixture repository. `base` is committed first, and `origin/main` names that
 * commit when `origin` is set, so `files` is the working tree the check reads.
 */
export async function fixture(
  files: Files,
  { base = {}, origin = true }: { base?: Files; origin?: boolean } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "kore-app-records-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "user.name=kore-test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { encoding: "utf8", env: withoutGit() },
    );
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  git("init", "--quiet");
  for (const path of copied) {
    await write(path, await readFile(new URL(path, repository), "utf8"));
  }
  for (const [path, text] of Object.entries(base)) {
    await write(path, text);
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", "chore: start the checkout");
  if (origin) {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  }
  for (const [path, text] of Object.entries(files)) {
    await write(path, text);
  }
  return {
    root,
    check: (overrides = {}) =>
      checkAppRecords({
        root,
        environment: "local",
        runner,
        yqVersion: "4.54.2",
        ...overrides,
      }),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/** A runner whose yq is not installed: its spawn fails the way a missing binary does. */
export const withoutYq: Runner = {
  run: (command, args, options) =>
    command === "yq"
      ? Promise.reject(
          Object.assign(new Error("spawn yq ENOENT"), { code: "ENOENT" }),
        )
      : runner.run(command, args, options),
};
