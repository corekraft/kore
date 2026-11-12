import { mkdtemp } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandError, ProcessRunner, RecordingRunner } from "./runner.js";
import { expect, test } from "vitest";

test("ProcessRunner captures output from a successful child process", async () => {
  const result = await new ProcessRunner().run(process.execPath, [
    "-e",
    "process.stdout.write('out'); process.stderr.write('err')",
  ]);

  expect(result).toEqual({ stdout: "out", stderr: "err", code: 0 });
});

test("ProcessRunner passes stdin, environment, and working directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kore-runner-"));
  const result = await new ProcessRunner().run(
    process.execPath,
    [
      "-e",
      "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write(JSON.stringify({input, env:process.env.KORE_RUNNER_TEST, cwd:process.cwd()})))",
    ],
    {
      cwd,
      env: { ...process.env, KORE_RUNNER_TEST: "present" },
      input: "payload",
    },
  );

  expect(JSON.parse(result.stdout)).toEqual({
    input: "payload",
    env: "present",
    cwd: realpathSync(cwd),
  });
});

test("ProcessRunner reports a failed child with its command and stderr", async () => {
  const runner = new ProcessRunner();
  await expect(
    runner.run(process.execPath, [
      "-e",
      "process.stderr.write('bad'); process.exit(7)",
    ]),
  ).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({
      command: process.execPath,
      result: { code: 7, stderr: "bad" },
    });
    return true;
  });
});

test("ProcessRunner rejects when the executable cannot be started", async () => {
  await expect(
    new ProcessRunner().run("kore-command-that-does-not-exist", []),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("ProcessRunner supports inherited output without capturing it", async () => {
  const result = await new ProcessRunner().run(process.execPath, ["-e", ""], {
    capture: false,
  });

  expect(result).toEqual({ stdout: "", stderr: "", code: 0 });
});

test("RecordingRunner records calls and consumes queued responses", async () => {
  const runner = new RecordingRunner([
    { stdout: "first", stderr: "", code: 0 },
  ]);

  await expect(
    runner.run("first", ["--flag"], { capture: true }),
  ).resolves.toEqual({
    stdout: "first",
    stderr: "",
    code: 0,
  });
  await expect(runner.run("second", [])).resolves.toEqual({
    stdout: "",
    stderr: "",
    code: 0,
  });
  expect(runner.calls).toEqual([
    { command: "first", args: ["--flag"], options: { capture: true } },
    { command: "second", args: [] },
  ]);
});

test("ProcessRunner hands a kubeconfig to the child through a file descriptor, never a file", async () => {
  const result = await new ProcessRunner().run(
    "sh",
    ["-c", 'printf "%s|" "$KUBECONFIG"; cat "$KUBECONFIG"'],
    { kubeconfig: "apiVersion: v1\n" },
  );

  const [path, content] = result.stdout.split("|");
  expect(path).toMatch(/^\/dev\/fd\/\d+$/);
  expect(content).toBe("apiVersion: v1\n");
});

test("ProcessRunner keeps the kubeconfig out of the arguments and the environment of the caller", async () => {
  const before = process.env.KUBECONFIG;
  const result = await new ProcessRunner().run("sh", ["-c", 'echo "$0 $*"'], {
    kubeconfig: "secret-config",
  });

  expect(result.stdout).not.toContain("secret-config");
  expect(process.env.KUBECONFIG).toBe(before);
});

test("ProcessRunner refuses a kubeconfig together with stdin input", async () => {
  await expect(
    new ProcessRunner().run("sh", ["-c", "true"], {
      kubeconfig: "a",
      input: "b",
    }),
  ).rejects.toThrow(/kubeconfig.*input/);
});

test("a failing command run with a kubeconfig reports the command and arguments the caller asked for, not the bash wrapper", async () => {
  const error = await new ProcessRunner()
    .run("sh", ["-c", "exit 3"], { kubeconfig: "k" })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(CommandError);
  const failure = error as CommandError;
  expect(failure.command).toBe("sh");
  expect(failure.args).toEqual(["-c", "exit 3"]);
  expect(failure.result.code).toBe(3);
  expect(failure.message).not.toContain("<(cat)");
});

test("a missing command run with a kubeconfig fails with ENOENT like a missing command without one", async () => {
  const error = await new ProcessRunner()
    .run("kore-no-such-cosign", ["sign"], { kubeconfig: "k" })
    .catch((caught: unknown) => caught);

  expect(error).toMatchObject({ code: "ENOENT" });
  expect((error as Error).message).toContain("kore-no-such-cosign");
});
