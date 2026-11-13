import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface SandboxPaths {
  /** The only tree a writer may change. */
  worktree: string;
  /** The shared .git of the main checkout (a worktree commit writes into it). */
  gitDir: string;
  /** The home directory whose credentials stay unreadable. */
  home: string;
  /** Unix sockets (herdr) the writer must not connect to. */
  deniedSockets: string[];
}

export const MARKER = "SECRET-MARKER";

const q = (path: string): string => JSON.stringify(path);

/**
 * A macOS sandbox-exec profile for a writer pane (ADR 0095): everything is
 * allowed except writes outside the worktree, reads of credential
 * directories, and connections to the denied sockets. The shared .git is
 * writable only where a worktree commit needs it, so the ref exposure is
 * limited to refs, objects, logs and this worktree's own metadata.
 */
export function sandboxProfile(paths: SandboxPaths): string {
  const name = basename(paths.worktree);
  const git = paths.gitDir;
  const writable = [
    paths.worktree,
    `${git}/worktrees/${name}`,
    `${git}/objects`,
    `${git}/refs`,
    `${git}/logs`,
  ];
  const worktreeGit = `${git}/worktrees/${name}`;
  const deniedHomeDirs = [
    "/.ssh",
    "/.kube",
    "/.aws",
    "/.docker",
    "/.config/gh",
    "/.config/git",
    "/.config/herdr",
    "/Library/Keychains",
  ];
  const deniedHomeFiles = ["/.netrc", "/.npmrc"];
  const readDenied = [
    ...deniedHomeDirs.map((d) => `(subpath ${q(paths.home + d)})`),
    ...deniedHomeFiles.map((d) => `(literal ${q(paths.home + d)})`),
  ];
  // Later rules win, so the guard files are denied after the worktree is allowed.
  const guardFiles = [
    `(subpath ${q(`${paths.worktree}/.claude`)})`,
    `(subpath ${q(`${paths.worktree}/skills/bin`)})`,
    `(literal ${q(`${paths.worktree}/.git`)})`,
    `(literal ${q(`${worktreeGit}/config`)})`,
    `(literal ${q(`${worktreeGit}/config.worktree`)})`,
    `(subpath ${q(`${worktreeGit}/hooks`)})`,
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((p) => `(subpath ${q(p)})`).join(" ")} (literal ${q(`${git}/packed-refs`)}) (literal ${q(`${git}/packed-refs.lock`)}) (literal "/dev/null") (literal "/dev/tty"))`,
    `(deny file-write* ${guardFiles.join(" ")})`,
    `(deny file-read* ${readDenied.join(" ")})`,
    // securityd reads the keychain files, so denying the files is not enough.
    '(deny mach-lookup (global-name "com.apple.SecurityServer"))',
    ...paths.deniedSockets.map(
      (s) =>
        `(deny network-outbound (remote unix-socket (path-literal ${q(s)})))`,
    ),
  ].join("\n");
}

/** Runs a command under the profile with the worktree as cwd. */
export function runSandboxed(
  profile: string,
  cwd: string,
  command: string,
  args: string[],
): SpawnSyncReturns<string> {
  return spawnSync("/usr/bin/sandbox-exec", ["-p", profile, command, ...args], {
    cwd,
    encoding: "utf8",
  });
}

const READ_DENIED_FILES = [
  ".ssh/id_test",
  ".kube/config",
  ".config/gh/hosts.yml",
  ".aws/credentials",
  ".docker/config.json",
  ".netrc",
  ".npmrc",
  ".config/git/config",
  "Library/Keychains/login.keychain-db",
];

const GUARD_FILES = [
  ".claude/settings.json",
  ".claude/hooks/harness.sh",
  "skills/bin/harness.mjs",
];

export interface Fixture {
  root: string;
  home: string;
  repo: string;
  worktree: string;
  sock: string;
  keychain: string;
  server: Server;
  profile: string;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

function seedFiles(base: string, rels: string[], content: string): void {
  for (const rel of rels) {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), content);
  }
}

/** A keychain file holding one generic password, MARKER, under service kore-sbx. */
function createKeychain(root: string): string {
  const keychain = join(root, "test.keychain-db");
  execFileSync("security", ["create-keychain", "-p", "pw", keychain]);
  execFileSync("security", ["unlock-keychain", "-p", "pw", keychain]);
  const add = [
    "add-generic-password",
    "-a",
    "a",
    "-s",
    "kore-sbx",
    "-w",
    MARKER,
  ];
  execFileSync("security", [...add, keychain]);
  return keychain;
}

/** A throwaway repo, linked worktree, fake home with a key, and a listening socket. */
export async function createFixture(): Promise<Fixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kore-sbx-")));
  const home = join(root, "home");
  seedFiles(home, READ_DENIED_FILES, MARKER);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  git(repo, "commit", "-q", "--allow-empty", "-m", "chore: init");
  const worktree = join(root, "repo-worktrees", "w1");
  git(repo, "worktree", "add", "-q", "-b", "feat/w1", worktree);
  seedFiles(worktree, GUARD_FILES, "guard");
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  writeFileSync(join(repo, ".git", "hooks", "pre-commit"), "hook");
  writeFileSync(join(repo, ".git", "worktrees", "w1", "config.worktree"), "");
  const keychain = createKeychain(root);
  const sock = join(root, "herdr.sock");
  const server = createServer((c) => c.end("pong"));
  await new Promise<void>((r) => server.listen(sock, r));
  const profile = sandboxProfile({
    worktree,
    gitDir: join(repo, ".git"),
    home,
    deniedSockets: [sock],
  });
  return { root, home, repo, worktree, sock, keychain, server, profile };
}

export function removeFixture(f: Fixture): void {
  spawnSync("security", ["delete-keychain", f.keychain]);
  f.server.close();
  git(f.repo, "worktree", "remove", "--force", f.worktree);
  rmSync(f.root, { recursive: true, force: true });
}
