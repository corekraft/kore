import { run } from "./cli/index.js";
import { ProcessRunner, nodeFileSystem, systemClock } from "./runtime/index.js";

process.exitCode = await run(process.argv.slice(2), {
  runner: new ProcessRunner(),
  clock: systemClock,
  fs: nodeFileSystem,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
