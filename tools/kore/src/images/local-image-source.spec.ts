import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import {
  imageDigest,
  imageEntry as entry,
  imageFakeRunner,
} from "../testing/index.js";
import type { PublishSession } from "./local-publish.js";
import { lookUpSource } from "./local-image-source.js";
import { digestIfPublished, localRepositoryPath } from "./local-publish.js";
import {
  ensureRegistryForward,
  verifiedRegistryAddress,
} from "./registry-service.js";
import { contextInputs, sourceTagOf } from "./local-image-context.js";
import { resolveBuildInputs } from "./local-image-base.js";

vi.mock("./registry-service.js", () => ({
  ensureRegistryForward: vi.fn(),
  verifiedRegistryAddress: vi.fn(),
}));
vi.mock("./local-publish.js", () => ({
  digestIfPublished: vi.fn(),
  localRepositoryPath: vi.fn(),
}));
vi.mock("./local-image-context.js", () => ({
  contextInputs: vi.fn(),
  sourceTagOf: vi.fn(),
}));
vi.mock("./local-image-base.js", () => ({ resolveBuildInputs: vi.fn() }));

const sourceTagName = "kore-src-0123456789abcdef";

/** The one cast: the lookup hands the repository only to functions this spec fakes. */
function repository(): Repository {
  return { root: "/repo" } as unknown as Repository;
}

function client(): PublishSession["client"] {
  return {
    address: "registry.platform.kore.local",
    env: {},
    authorization: "Basic a29yZTpwdw==",
    head: vi.fn(),
    caFile: "/tmp/ca.crt",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contextInputs).mockResolvedValue({
    hash: "0123456789abcdef",
    dockerfile: "FROM base",
  });
  vi.mocked(resolveBuildInputs).mockResolvedValue({
    bases: ["sha256:base"],
    platform: "linux/arm64",
  });
  vi.mocked(sourceTagOf).mockReturnValue(sourceTagName);
  vi.mocked(digestIfPublished).mockResolvedValue(undefined);
  vi.mocked(verifiedRegistryAddress).mockResolvedValue("10.96.0.50:5000");
  vi.mocked(localRepositoryPath).mockReturnValue("reference");
});

test("the registry is ready before the source tag is looked up in the registry", async () => {
  const { runner } = imageFakeRunner();

  await lookUpSource(repository(), runner, "reference", entry, client());

  expect(ensureRegistryForward).toHaveBeenCalledTimes(1);
  expect(digestIfPublished).toHaveBeenCalledWith(
    expect.any(String),
    expect.anything(),
    sourceTagName,
  );
  expect(
    vi.mocked(ensureRegistryForward).mock.invocationCallOrder[0]!,
  ).toBeLessThan(vi.mocked(digestIfPublished).mock.invocationCallOrder[0]!);
});

test("a published source is reused at the registry address, once the forward is up", async () => {
  const { runner } = imageFakeRunner();
  vi.mocked(digestIfPublished).mockResolvedValue(imageDigest);

  const found = await lookUpSource(
    repository(),
    runner,
    "reference",
    entry,
    client(),
  );

  expect(found.reused?.reference).toBe(
    `10.96.0.50:5000/reference@${imageDigest}`,
  );
  expect(ensureRegistryForward).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(ensureRegistryForward).mock.invocationCallOrder[0]!,
  ).toBeLessThan(vi.mocked(digestIfPublished).mock.invocationCallOrder[0]!);
});

test("a context with no Dockerfile has no source tag, so the run builds and reuses nothing", async () => {
  const { runner } = imageFakeRunner();
  vi.mocked(contextInputs).mockResolvedValue({
    hash: undefined,
    dockerfile: undefined,
  });

  const found = await lookUpSource(
    repository(),
    runner,
    "reference",
    entry,
    client(),
  );

  expect(found.source).toBeUndefined();
  expect(found.reused).toBeUndefined();
  expect(resolveBuildInputs).not.toHaveBeenCalled();
  expect(digestIfPublished).not.toHaveBeenCalled();
  expect(ensureRegistryForward).not.toHaveBeenCalled();
});

test("a base image that cannot be resolved has no source tag, and the run says why", async () => {
  const { runner } = imageFakeRunner();
  vi.mocked(resolveBuildInputs).mockResolvedValue(undefined);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  const found = await lookUpSource(
    repository(),
    runner,
    "reference",
    entry,
    client(),
  );

  expect(found.source).toBeUndefined();
  expect(digestIfPublished).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledWith(
    "could not resolve the base image of apps/reference; building without reusing an earlier image\n",
  );
});
