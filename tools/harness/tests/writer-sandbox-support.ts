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
import { basename, join } from "node:path";

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

const q = (path: string): string => JSON.stringify(path);

/**
 * A macOS sandbox-exec profile for a writer pane (ADR 0094): everything is
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
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((p) => `(subpath ${q(p)})`).join(" ")} (literal ${q(`${git}/packed-refs`)}) (literal ${q(`${git}/packed-refs.lock`)}) (literal "/dev/null") (literal "/dev/tty"))`,
    `(deny file-read* ${["/.ssh", "/.kube", "/.config/gh", "/.config/herdr"].map((d) => `(subpath ${q(paths.home + d)})`).join(" ")})`,
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

export interface Fixture {
  root: string;
  home: string;
  repo: string;
  worktree: string;
  sock: string;
  server: Server;
  profile: string;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** A throwaway repo, linked worktree, fake home with a key, and a listening socket. */
export async function createFixture(): Promise<Fixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kore-sbx-")));
  const home = join(root, "home");
  mkdirSync(join(home, ".ssh"), { recursive: true });
  writeFileSync(join(home, ".ssh", "id_test"), "PRIVATE-KEY-MARKER");
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  git(repo, "commit", "-q", "--allow-empty", "-m", "chore: init");
  const worktree = join(root, "repo-worktrees", "w1");
  git(repo, "worktree", "add", "-q", "-b", "feat/w1", worktree);
  const sock = join(root, "herdr.sock");
  const server = createServer((c) => c.end("pong"));
  await new Promise<void>((r) => server.listen(sock, r));
  const profile = sandboxProfile({
    worktree,
    gitDir: join(repo, ".git"),
    home,
    deniedSockets: [sock],
  });
  return { root, home, repo, worktree, sock, server, profile };
}

export function removeFixture(f: Fixture): void {
  f.server.close();
  git(f.repo, "worktree", "remove", "--force", f.worktree);
  rmSync(f.root, { recursive: true, force: true });
}
