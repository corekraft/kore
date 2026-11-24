// Makes the throwaway copy the local external-dns proof converges from (issue #1617). Run it from tools/kore:
//   npm run external-dns:proof-root -- <new directory>
// It adds a detached worktree of HEAD at that directory and turns the proof flags on in the copy's local
// environment only; the checkout's tracked overlay is never edited.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProofRoot } from "../dist/src/platform/external-dns-proof-root.js";
import { ProcessRunner } from "../dist/src/runtime/index.js";

const dest = process.argv[2];
if (dest === undefined || dest === "") {
  console.error("usage: npm run external-dns:proof-root -- <new directory>");
  process.exit(2);
}

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const copy = await prepareProofRoot({
  root: repository,
  dest: resolve(dest),
  runner: new ProcessRunner(),
  files: {
    read: (path) => readFile(path, "utf8"),
    write: (path, text) => writeFile(path, text),
  },
});

console.log(`throwaway proof root: ${copy}`);
console.log(
  `converge it from tools/kore: KORE_ROOT=${copy} npm run kore -- local up`,
);
console.log(
  `then prove it from tools/kore: KORE_ROOT=${copy} KORE_EXTERNAL_DNS_IDEA=<idea> npm run test:live:external-dns`,
);
