// Docs: docs/decisions/0135-pods-resolve-platform-names-through-the-bundled-dns-and-trust-the-local-ca-from-a-configmap.md
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadRepository, platformPlan } from "../../src/config/index.js";

const run = promisify(execFile);

// Opt-in: it needs docker and dig, and runs the pinned CoreDNS image. Run with
// `npm run test:coredns-rewrite` when changing the custom DNS ConfigMap.
const enabled = process.env["KORE_CHECK_COREDNS_REWRITE"] === "1";
const gatewayService = "kore-gateway.kore-system.svc.cluster.local";

/** The rendered `platform.override` text, as CoreDNS would import it. */
async function renderedOverride(): Promise<{ text: string; image: string }> {
  const repository = await loadRepository("local");
  const { domain } = platformPlan(repository.environment);
  const output = execFileSync(
    "helm",
    [
      "template",
      "kore-platform-dns",
      join(repository.root, "infra/charts/platform-dns"),
      "--namespace",
      "kore-dns",
      "--set",
      "features.platform-dns=true",
      "--set-string",
      `zone=${domain}`,
    ],
    { encoding: "utf8" },
  );
  const lines = output.split("\n");
  const start = lines.findIndex((l) => l.trim() === "platform.override: |");
  assert.notEqual(start, -1, "the custom DNS ConfigMap renders");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("    ")) {
      break;
    }
    body.push(line.slice(4));
  }
  const image = repository.versions.images["platform-dns"];
  assert.ok(image, "the DNS server image is pinned");
  return { text: body.join("\n"), image };
}

async function answers(port: number, name: string): Promise<string[]> {
  const { stdout } = await run("dig", [
    "@127.0.0.1",
    "-p",
    String(port),
    name,
    "A",
    "+noall",
    "+answer",
    "+time=2",
    "+tries=1",
  ]);
  return stdout
    .split("\n")
    .filter((l) => !l.startsWith(";"))
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length >= 5)
    .map((f) => `${f[0]} ${f[4]}`);
}

test.runIf(enabled)(
  "real CoreDNS returns the asked name for every name in the zone, and nothing for a name outside it",
  async () => {
    const { text, image } = await renderedOverride();
    const dir = await mkdtemp(join(tmpdir(), "kore-coredns-"));
    const name = `kore-coredns-rewrite-${process.pid}`;
    const port = 20000 + (process.pid % 10000);
    const { domain } = platformPlan(
      (await loadRepository("local")).environment,
    );
    try {
      // `hosts` stands in for the cluster's Service record the rewrite points at.
      await writeFile(
        join(dir, "Corefile"),
        `.:1053 {\n${text.replace(/^/gm, "    ")}\n    hosts {\n        10.1.2.3 ${gatewayService}\n    }\n    errors\n}\n`,
      );
      await run("docker", [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "-p",
        `127.0.0.1:${port}:1053/udp`,
        "-v",
        `${join(dir, "Corefile")}:/Corefile:ro`,
        image,
        "-conf",
        "/Corefile",
      ]);
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
        await sleep(500);
        ready = (await answers(port, `ready.platform.${domain}`)).length > 0;
      }
      assert.ok(ready, "CoreDNS answers with the rewrite block loaded");
      for (const asked of [
        `keycloak.platform.${domain}`,
        `a.b.platform.${domain}`,
        domain,
      ]) {
        assert.deepEqual(await answers(port, asked), [`${asked}. 10.1.2.3`]);
      }
      assert.deepEqual(await answers(port, `x.${domain}.evil`), []);
      assert.deepEqual(await answers(port, "example.com"), []);
    } finally {
      await run("docker", ["rm", "-f", name]).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);

test.skipIf(enabled)(
  "the real CoreDNS rewrite check is opt-in: set KORE_CHECK_COREDNS_REWRITE=1 (needs docker and dig)",
  () => undefined,
);
