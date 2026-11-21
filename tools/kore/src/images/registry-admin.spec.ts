import { describe, expect, it, vi } from "vitest";
import { RegistryPruneError } from "./registry-prune-error.js";
import { createRegistryAdmin } from "./registry-admin.js";
import type { RegistryResponse } from "./registry-https.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

const base = "https://registry.platform.kore.local/v2";
const digest = `sha256:${"a".repeat(64)}`;
const reply = (
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): RegistryResponse => ({ status, headers, body: JSON.stringify(body) });

/** An admin whose registry answers each URL from `answers`; others are a 404. */
function admin(answers: Record<string, RegistryResponse>) {
  const request = vi.fn(
    async (
      method: string,
      url: string,
      _headers: Record<string, string>,
      _ca: string,
    ): Promise<RegistryResponse> => answers[`${method} ${url}`] ?? reply(404),
  );
  return {
    request,
    registry: createRegistryAdmin({
      request,
      address: "registry.platform.kore.local",
      authorization: "Basic abc",
      ca: "ca-pem",
    }),
  };
}

describe("registry admin", () => {
  it("lists repositories and tags", async () => {
    const { registry } = admin({
      [`GET ${base}/_catalog`]: reply(200, { repositories: ["a/b"] }),
      [`GET ${base}/a/b/tags/list`]: reply(200, { tags: ["t1", "t2"] }),
    });
    expect(await registry.repositories()).toEqual(["a/b"]);
    expect(await registry.tags("a/b")).toEqual(["t1", "t2"]);
  });

  it("reads a tag's digest from the manifest HEAD and signs every request with the push credential", async () => {
    const { registry, request } = admin({
      [`HEAD ${base}/a/b/manifests/t1`]: reply(
        200,
        {},
        {
          "docker-content-digest": digest,
        },
      ),
    });
    expect(await registry.digest("a/b", "t1")).toBe(digest);
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      Authorization: "Basic abc",
    });
    expect(request.mock.calls[0]?.[3]).toBe("ca-pem");
  });
});

describe("registry admin refusals", () => {
  it("refuses a tag whose HEAD carries no verified digest, so no delete can name an empty one", async () => {
    const { registry } = admin({
      [`HEAD ${base}/a/b/manifests/t1`]: reply(200),
      [`HEAD ${base}/a/b/manifests/t2`]: reply(
        200,
        {},
        {
          "docker-content-digest": "sha256:short",
        },
      ),
    });
    await expect(registry.digest("a/b", "t1")).rejects.toThrow(
      "registry returned no sha256 digest for a/b:t1",
    );
    await expect(registry.digest("a/b", "t2")).rejects.toBeInstanceOf(
      RegistryPruneError,
    );
  });

  it("reads the build time from the image config", async () => {
    const { registry } = admin({
      [`GET ${base}/a/b/manifests/t1`]: reply(200, {
        config: { digest: "sha256:cfg" },
      }),
      [`GET ${base}/a/b/blobs/sha256:cfg`]: reply(200, {
        created: "2026-01-02T00:00:00Z",
      }),
    });
    expect(await registry.created("a/b", "t1")).toBe(
      Date.parse("2026-01-02T00:00:00Z"),
    );
  });

  it("treats an image with no readable build time as brand new, so it is spared", async () => {
    const { registry } = admin({
      [`GET ${base}/a/b/manifests/t1`]: reply(200, { manifests: [] }),
    });
    expect(await registry.created("a/b", "t1")).toBe(Infinity);
  });

  it("deletes a manifest by digest and fails on any answer but 202", async () => {
    const { registry } = admin({
      [`DELETE ${base}/a/b/manifests/${digest}`]: reply(202),
      [`DELETE ${base}/a/c/manifests/${digest}`]: reply(405),
    });
    await expect(registry.remove("a/b", digest)).resolves.toBeUndefined();
    await expect(registry.remove("a/c", digest)).rejects.toThrow(
      "registry answered 405 deleting a/c",
    );
  });

  it("fails rather than guess when a listing is refused", async () => {
    const { registry } = admin({
      [`GET ${base}/_catalog`]: reply(403),
    });
    await expect(registry.repositories()).rejects.toThrow(
      "registry answered 403 for GET",
    );
  });
});

describe("registry admin by name", () => {
  it("sends every request to the address it is given, with no port-forward in the URL", async () => {
    const request = vi.fn(async (): Promise<RegistryResponse> =>
      reply(200, { repositories: ["a/b"] }),
    );
    const registry = createRegistryAdmin({
      request,
      address: "registry.platform.kore.internal",
      authorization: "Basic abc",
      ca: "ca-pem",
    });

    await registry.repositories();

    expect(request).toHaveBeenCalledWith(
      "GET",
      "https://registry.platform.kore.internal/v2/_catalog",
      expect.anything(),
      "ca-pem",
    );
  });
});
