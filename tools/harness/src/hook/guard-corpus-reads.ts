// The seven reads (#847) as corpus data: each allowed by its exact argv shape, and the writing options
// and git fetch refused. guard-corpus.ts runs both through the hook for every read-only role.

/** Calls every read-only role must keep running. */
export const READS_ALLOWED: readonly string[] = [
  "git merge-base HEAD origin/main",
  "git merge-base --is-ancestor HEAD origin/main",
  "git cat-file -p HEAD",
  "git cat-file -t origin/main",
  "git ls-tree -r --name-only origin/main docs",
  "git ls-remote --heads origin main",
  "which git",
  "command -v node",
  "node skills/bin/harness.mjs --help",
];

/** Calls no read-only role may run: an option that writes a file or runs code, and git fetch. */
export const READS_REFUSED: readonly string[] = [
  "git ls-remote --upload-pack=sh origin",
  "git ls-remote --upload-pack sh origin",
  "git ls-remote --exec=sh origin",
  "git ls-remote -o x origin",
  "git ls-remote 'ext::sh -c id' x",
  "git -c protocol.ext.allow=always ls-remote origin",
  "git -c core.pager=sh cat-file -p HEAD",
  "git cat-file --textconv HEAD:a",
  "git cat-file --filters HEAD:a",
  "git cat-file --output=f -p HEAD",
  "git ls-tree --output=f HEAD",
  "git ls-tree -o f HEAD",
  "git merge-base --upload-pack=x a b",
  "git merge-base --output=f a b",
  "git merge-base HEAD origin/main > base.txt",
  "git cat-file -p HEAD > obj.txt",
  "git fetch origin",
  "git fetch --upload-pack=sh origin",
  "command -p git push",
  "which git > out.txt",
];
