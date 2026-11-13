import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after as cleanup } from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
import { loadRegistryCredential, rotateRegistryCredentials } from "./index.js";
import type { RegistryCredential } from "./index.js";
import { localRegistryReference } from "./registry.js";
import { loadRegistryCa } from "./registry-tls.js";

// Docs: docs/decisions/0055-registry-credential-rotation.md and
// docs/decisions/0058-registry-transport-tls.md
// Live: needs a running local profile after `kore local up` (a signed,
// deployed reference image). Run with KORE_RUN_INTEGRATION=1.

const forwardedHost = "127.0.0.1:30500";
const forwarded = `https://${forwardedHost}`;

// The PUBLIC CA only, read the way kore reads it; credentials never use a file.
let caDirectory: string | undefined;
let caFile = "";
async function registryCaFile(runner: Runner): Promise<string> {
  if (caFile === "") {
    const repository = await loadRepository(integrationEnvironment());
    caDirectory = await mkdtemp(join(tmpdir(), "kore-registry-ca-"));
    caFile = join(caDirectory, "ca.crt");
    await writeFile(caFile, await loadRegistryCa(repository, runner));
  }
  return caFile;
}
cleanup(async () => {
  if (caDirectory !== undefined) {
    await rm(caDirectory, { force: true, recursive: true });
  }
});

type Repository = Awaited<ReturnType<typeof loadRepository>>;

/**
 * One request through the port-forward. The credential reaches curl as a
 * config on stdin (`-K -`), never in an argument.
 */
async function status(
  runner: Runner,
  method: string,
  path: string,
  credential?: RegistryCredential,
  scheme: { url?: string; cacert?: boolean } = {},
): Promise<{ code: number; body: string }> {
  const config = [
    `url = "${scheme.url ?? forwarded}${path}"`,
    `request = "${method}"`,
    ...(credential
      ? [`user = "${credential.username}:${credential.password}"`]
      : []),
  ].join("\n");
  const { stdout } = await runner.run(
    "curl",
    [
      "--silent",
      "--show-error",
      ...(scheme.cacert === false
        ? []
        : ["--cacert", await registryCaFile(runner)]),
      "--write-out",
      "\n%{http_code}",
      "--config",
      "-",
    ],
    { capture: true, input: `${config}\n` },
  );
  const boundary = stdout.lastIndexOf("\n");
  return {
    code: Number(stdout.slice(boundary + 1)),
    body: stdout.slice(0, boundary),
  };
}

/** Retries while the port-forward re-attaches to a new pod. */
async function eventually<T>(
  work: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  let last = await work().catch(() => undefined);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (last !== undefined && done(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    last = await work().catch(() => undefined);
  }
  assert.fail("the registry never became reachable through the port-forward");
}

async function inventory(
  runner: Runner,
  credential: RegistryCredential,
): Promise<string[]> {
  const catalog = JSON.parse(
    (await status(runner, "GET", "/v2/_catalog", credential)).body,
  ) as { repositories: string[] };
  const entries: string[] = [];
  for (const name of catalog.repositories) {
    const tags = JSON.parse(
      (await status(runner, "GET", `/v2/${name}/tags/list`, credential)).body,
    ) as { tags: string[] | null };
    entries.push(...(tags.tags ?? []).map((tag) => `${name}:${tag}`));
  }
  return entries.sort();
}

async function kubectl(
  repository: Repository,
  runner: Runner,
  args: string[],
): Promise<void> {
  await runner.run(
    "kubectl",
    ["--context", repository.environment.kubeContext, ...args],
    { capture: true },
  );
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
      : false,
  timeout: 20 * 60 * 1000,
};

test(
  "the registry keeps images and signatures across a restart and keeps refusing anonymous access",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const runner = new ProcessRunner();
    const read = await loadRegistryCredential(repository, runner, "read");
    await localRegistryReference(repository, runner, "kore/x");
    const before = await inventory(runner, read);
    assert.ok(
      before.some((entry) => entry.endsWith(".sig")),
      "a signature tag must exist before the restart",
    );

    await kubectl(repository, runner, [
      "--namespace",
      "kore-registry",
      "rollout",
      "restart",
      "deployment/oci-registry",
    ]);
    await kubectl(repository, runner, [
      "--namespace",
      "kore-registry",
      "rollout",
      "status",
      "deployment/oci-registry",
      "--timeout=180s",
    ]);

    // The restart replaces the pod the forward was bound to; kore re-opens it
    // the same way every command does before reaching the registry.
    const reachable = async () =>
      await localRegistryReference(repository, runner, "kore/x");
    const anonymous = await eventually(
      async () => {
        await reachable();
        return await status(runner, "GET", "/v2/");
      },
      (response) => response.code === 401,
    );
    assert.equal(anonymous.code, 401, "anonymous pull must stay refused");
    assert.equal(
      (await status(runner, "POST", "/v2/kore-anon/blobs/uploads/")).code,
      401,
      "anonymous push must stay refused",
    );
    const after = await eventually(
      async () => {
        await reachable();
        return await inventory(runner, read);
      },
      (entries) => entries.length >= before.length,
    );
    assert.deepEqual(after, before, "images and signatures must survive");
  },
);

test(
  "rotating the credentials refuses the old ones, accepts the new, and still admits a signed image",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const runner = new ProcessRunner();
    const oldPush = await loadRegistryCredential(repository, runner, "push");
    const oldRead = await loadRegistryCredential(repository, runner, "read");
    await localRegistryReference(repository, runner, "kore/x");

    await rotateRegistryCredentials(repository, runner, { yes: true });

    const newPush = await loadRegistryCredential(repository, runner, "push");
    const newRead = await loadRegistryCredential(repository, runner, "read");
    assert.notEqual(newPush.password, oldPush.password);
    assert.notEqual(newRead.password, oldRead.password);
    for (const old of [oldPush, oldRead]) {
      assert.equal(
        (await status(runner, "GET", "/v2/", old)).code,
        401,
        "an old password must be refused",
      );
    }
    assert.equal(
      (await status(runner, "GET", "/v2/", newRead)).code,
      200,
      "the new read credential must pull",
    );
    assert.equal(
      (
        await status(
          runner,
          "POST",
          "/v2/kore-rotation/blobs/uploads/",
          newRead,
        )
      ).code,
      403,
      "the new read credential must not push",
    );
    assert.equal(
      (
        await status(
          runner,
          "POST",
          "/v2/kore-rotation/blobs/uploads/",
          newPush,
        )
      ).code,
      202,
      "the new push credential must push",
    );

    // A fresh pod must pass admission, which reads the signature with the
    // rotated pull Secret in the namespace.
    const selector = "app.kubernetes.io/part-of=reference";
    await kubectl(repository, runner, [
      "--namespace",
      "reference",
      "rollout",
      "restart",
      "deployment",
      "--selector",
      selector,
    ]);
    await kubectl(repository, runner, [
      "--namespace",
      "reference",
      "rollout",
      "status",
      "deployment",
      "--selector",
      selector,
      "--timeout=300s",
    ]);
  },
);

test(
  "the read credential pulls but cannot push while the push credential can",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const runner = new ProcessRunner();
    const read = await loadRegistryCredential(repository, runner, "read");
    const push = await loadRegistryCredential(repository, runner, "push");
    await localRegistryReference(repository, runner, "kore/x");
    const upload = "/v2/kore-authorization-probe/blobs/uploads/";

    assert.equal(
      (await status(runner, "GET", "/v2/", read)).code,
      200,
      "the read credential must pull",
    );
    const refused = await status(runner, "POST", upload, read);
    assert.equal(
      refused.code,
      403,
      "the read credential must be refused a blob upload with 403, not 401",
    );
    const accepted = await status(runner, "POST", upload, push);
    assert.equal(
      accepted.code,
      202,
      "the push credential must start an upload",
    );
  },
);

test(
  "the registry answers only HTTPS verified against the kore CA: plain HTTP and an unverified HTTPS request both fail",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const runner = new ProcessRunner();
    const read = await loadRegistryCredential(repository, runner, "read");
    await localRegistryReference(repository, runner, "kore/x");

    assert.equal(
      (await status(runner, "GET", "/v2/", read)).code,
      200,
      "HTTPS with the CA must work",
    );

    // nginx answers a plain request on its TLS port with 400 at most; no
    // registry response (200, 401, 202) may ever come back over HTTP.
    const plain = await status(runner, "GET", "/v2/", read, {
      url: `http://${forwardedHost}`,
      cacert: false,
    }).catch(() => undefined);
    assert.ok(
      plain === undefined || ![200, 202, 401].includes(plain.code),
      `plain HTTP must not reach the registry (got ${plain?.code})`,
    );

    // Without the CA, curl must reject the certificate (exit 60), not skip it.
    await assert.rejects(
      status(runner, "GET", "/v2/", read, { cacert: false }),
      /certificate|\b60\b/i,
      "HTTPS without the CA must fail verification",
    );
  },
);
