import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { rewireRegistryService } from "./registry-rewire.js";

const lookup = (stdout: string) => ({ stdout, stderr: "", code: 0 });

test("a registry Service on another clusterIP is deleted alone and reported", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("10.99.1.2")]);
  const messages: string[] = [];

  const rewired = await rewireRegistryService(repository, runner, (m) =>
    messages.push(m),
  );

  assert.equal(rewired, true);
  assert.equal(runner.calls.length, 2);
  assert.deepEqual(runner.calls[1]?.args, [
    "--context",
    "kore-local",
    "--namespace",
    "kore-registry",
    "delete",
    "service",
    "oci-registry",
    "--ignore-not-found",
  ]);
  assert.match(messages.join("\n"), /10\.99\.1\.2.*10\.96\.0\.50/);
  assert.equal(
    runner.calls.some(({ args }) =>
      args.some((a) => /deployment|pvc|persistentvolumeclaim|helm/.test(a)),
    ),
    false,
  );
});

test("a registry Service already on the pinned clusterIP is left alone", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("10.96.0.50")]);
  assert.equal(await rewireRegistryService(repository, runner), false);
  assert.equal(runner.calls.length, 1);
});

test("an absent registry Service is not an error and deletes nothing", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("")]);
  assert.equal(await rewireRegistryService(repository, runner), false);
  assert.equal(
    runner.calls.some(({ args }) => args.includes("delete")),
    false,
  );
});

test("environments without a pinned registry address never touch the Service", async () => {
  const repository = await loadRepository("managed-example");
  const runner = new RecordingRunner();
  assert.equal(await rewireRegistryService(repository, runner), false);
  assert.equal(runner.calls.length, 0);
});
