import { expect, test } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { resolveBuildInputs } from "./local-image-base.js";

// Docs: AGENTS.md "Pin everything." (the base image digest is part of the input)

const digestOf = (n: string) => `sha256:${n.repeat(64)}`;

function runnerFor(
  answers: Record<string, string | Error>,
  platform: string | Error = "linux/arm64\n",
) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      const key = args[0] === "version" ? "version" : args[3]!;
      const answer = key === "version" ? platform : answers[key];
      if (answer instanceof Error) {
        throw answer;
      }
      return { stdout: answer ?? "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

const failure = new CommandError("docker", ["x"], {
  stdout: "",
  stderr: "boom",
  code: 1,
});

test("each FROM resolves to name@digest and the platform comes from the docker daemon", async () => {
  const { runner } = runnerFor({ "node:26": `${digestOf("1")}\n` });

  expect(await resolveBuildInputs(runner, "FROM node:26\nCOPY . .\n")).toEqual({
    bases: [`node:26@${digestOf("1")}`],
    platform: "linux/arm64",
  });
});

test("a base already pinned by digest needs no lookup, and scratch and earlier stages are skipped", async () => {
  const pinned = `node@${digestOf("2")}`;
  const { runner, calls } = runnerFor({});

  const inputs = await resolveBuildInputs(
    runner,
    `FROM ${pinned} AS build\nFROM scratch\nFROM build\n`,
  );

  expect(inputs?.bases).toEqual([pinned]);
  expect(calls.filter(([, first]) => first === "buildx")).toEqual([]);
});

test("a base that cannot be resolved means no inputs, so the caller builds instead of reusing", async () => {
  const unresolved = [
    runnerFor({ "node:26": failure }),
    runnerFor({ "node:26": "not a digest\n" }),
    runnerFor({ "node:26": "" }),
  ];
  for (const { runner } of unresolved) {
    expect(await resolveBuildInputs(runner, "FROM node:26\n")).toBeUndefined();
  }
});

test("an unknown platform means no inputs", async () => {
  const { runner } = runnerFor({ "node:26": digestOf("1") }, failure);
  expect(await resolveBuildInputs(runner, "FROM node:26\n")).toBeUndefined();
  const odd = runnerFor({ "node:26": digestOf("1") }, "weird\n");
  expect(
    await resolveBuildInputs(odd.runner, "FROM node:26\n"),
  ).toBeUndefined();
});

test("a FROM that depends on a build argument means no inputs, since the value is not known here", async () => {
  const { runner } = runnerFor({});
  expect(
    await resolveBuildInputs(runner, "ARG V=26\nFROM node:${V}\n"),
  ).toBeUndefined();
});

test("an error that is not a command failure is not swallowed", async () => {
  const { runner } = runnerFor({ "node:26": new TypeError("bug") });
  await expect(resolveBuildInputs(runner, "FROM node:26\n")).rejects.toThrow(
    "bug",
  );
});

test("a Dockerfile with no FROM has no inputs", async () => {
  const { runner } = runnerFor({});
  expect(await resolveBuildInputs(runner, "# nothing\n")).toBeUndefined();
});
