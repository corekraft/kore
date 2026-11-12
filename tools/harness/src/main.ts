import { run } from "./cli/cli.js";
import { systemClock } from "./runtime/clock.js";
import { nodeFileSystem } from "./runtime/filesystem.js";
import { ProcessRunner } from "./runtime/runner.js";

process.exitCode = await run(process.argv.slice(2), {
  runner: new ProcessRunner(),
  clock: systemClock,
  fs: nodeFileSystem,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
