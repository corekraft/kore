import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Component, Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { type RunResult } from "../runtime/index.js";
import { reconcileComponent } from "./reconcile.js";

const fail = (stderr: string): RunResult => ({ stdout: "", stderr, code: 1 });

const rendered = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: policy-controller-webhook
spec:
  template:
    spec:
      containers:
      - name: other
        livenessProbe:
          httpGet:
            path: /healthz
`;

async function patched(): Promise<{
  repository: Repository;
  component: Component;
}> {
  const repository = await loadRepository("local");
  return {
    repository,
    component: repository.catalog.components.find(
      ({ name }) => name === "policy-controller",
    )!,
  };
}

function runner(
  commands: { command: string; args: readonly string[] }[],
  template: RunResult,
): Runner {
  return {
    async run(command, args) {
      commands.push({ command, args });
      if (command === "helm" && args[0] === "upgrade") {
        throw new CommandError(command, args, fail("plugin exited with error"));
      }
      if (command === "helm" && args[0] === "template") {
        if (template.code !== 0) {
          throw new CommandError(command, args, template);
        }
        return template;
      }
      if (command === "helm" && args[0] === "history") {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("a failed helm upgrade of a patched component reports the patch error Helm hides", async () => {
  const { repository, component } = await patched();
  const commands: { command: string; args: readonly string[] }[] = [];
  await assert.rejects(
    reconcileComponent(
      repository,
      runner(commands, { stdout: rendered, stderr: "", code: 0 }),
      component,
    ),
    /policy-controller.*patch target Deployment\/policy-controller-webhook container policy-controller-webhook not found/s,
  );
  const template = commands.find(
    ({ command, args }) => command === "helm" && args[0] === "template",
  )!;
  assert.equal(template.args.includes("--post-renderer"), false);
  assert.equal(template.args.includes("--post-renderer-args"), false);
});

test("a helm failure the patches did not cause keeps its own error", async () => {
  const { repository, component } = await patched();
  const good = rendered.replace(
    "name: other",
    "name: policy-controller-webhook",
  );
  await assert.rejects(
    reconcileComponent(
      repository,
      runner([], { stdout: good, stderr: "", code: 0 }),
      component,
    ),
    /plugin exited with error/,
  );
});

test("a component without patches never renders a diagnostic template", async () => {
  const { repository, component } = await patched();
  const { patches: _patches, ...plain } = component;
  const commands: { command: string; args: readonly string[] }[] = [];
  await assert.rejects(
    reconcileComponent(
      repository,
      runner(commands, { stdout: rendered, stderr: "", code: 0 }),
      plain,
    ),
  );
  assert.equal(
    commands.some(({ args }) => args[0] === "template"),
    false,
  );
});
