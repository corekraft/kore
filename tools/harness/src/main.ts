import { run } from "./cli/index.js";
import {
  ProcessRunner,
  nodeFileSystem,
  resolveRoot,
  systemClock,
  systemIds,
} from "./runtime/index.js";

const stderr = (text: string) => process.stderr.write(text);

let root: Promise<string> | undefined;

try {
  process.exitCode = await run(process.argv.slice(2), {
    runner: new ProcessRunner(),
    clock: systemClock,
    fs: nodeFileSystem,
    ids: systemIds,
    env: process.env,
    cwd: process.cwd(),
    stdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    root: () =>
      (root ??= resolveRoot(process.env, import.meta.url, (path) =>
        nodeFileSystem.exists(path),
      )),
    stdout: (text) => process.stdout.write(text),
    stderr,
  });
} catch (error) {
  stderr(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
