import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

// Docs: docs/decisions/0028-image-trust-authority.md ("Fail closed")
// Opt-in: it pulls the pinned chart, and fast tests run offline (AGENTS.md).
// Run with `npm run test:upstream-charts` when bumping policy-controller.

const run = promisify(execFile);

interface Webhook {
  kind: string;
  name: string;
  failurePolicy: string | undefined;
}

/** Every webhook the pinned chart renders, with its failurePolicy. */
function webhooks(rendered: string): Webhook[] {
  const result: Webhook[] = [];
  for (const document of rendered.split(/^---$/m)) {
    const kind = /^kind: (Mutating|Validating)WebhookConfiguration$/m.exec(
      document,
    )?.[0];
    if (!kind) {
      continue;
    }
    const metadata = /^metadata:\n {2}name: (\S+)/m.exec(document)?.[1];
    for (const entry of document.split(/^ {0,2}- /m).slice(1)) {
      if (!/^\s*(?:name: \S+\n)?[\s\S]*admissionReviewVersions/m.test(entry)) {
        continue;
      }
      result.push({
        kind,
        name: metadata ?? "?",
        failurePolicy: /failurePolicy: (\S+)/.exec(entry)?.[1],
      });
    }
  }
  return result;
}

test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "every policy-controller admission webhook fails closed",
  async () => {
    const repository = await loadRepository("local");
    const component = repository.catalog.components!.find(
      (c) => c.name === "policy-controller",
    )!;
    const { stdout } = await run(
      "helm",
      [
        "template",
        "policy-controller",
        component.chart!,
        "--repo",
        component.repository!,
        "--version",
        repository.versions.components["policy-controller"]!,
        "--namespace",
        component.namespace,
        "--values",
        join(repository.root, component.values![0]!),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const found = webhooks(stdout);

    // The image-verifying webhook and the policy webhooks: if the controller is
    // unreachable the API server must deny, never admit unverified images.
    assert.ok(found.length >= 4, `rendered ${found.length} webhooks`);
    assert.ok(
      found.some(({ name }) => name === "policy.sigstore.dev"),
      "the image verification webhook is rendered",
    );
    for (const webhook of found) {
      assert.equal(
        webhook.failurePolicy,
        "Fail",
        `${webhook.kind} ${webhook.name} must have failurePolicy: Fail`,
      );
    }
    assert.ok(
      !/failurePolicy: Ignore/.test(stdout),
      "no webhook may ignore failures",
    );
  },
  120_000,
);
