// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
import { readFile, readdir } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { loadApplicationImages } from "./application-image-records.js";
import { applicationImagesOf } from "./application-images.js";
import { servicesDirectory } from "./app-records.js";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";

// Issue 1556: while suborg-image-policy is on, loadRepository reads each app record's
// spec and release file from the environment's services directory and hands them to
// applicationImagesOf. Read-only: it reads the working tree and nothing else.

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), readdir: vi.fn() }));
vi.mock("./application-images.js", () => ({ applicationImagesOf: vi.fn() }));
vi.mock("./app-records.js", () => ({ servicesDirectory: vi.fn() }));
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  suborgImagePolicyFlag: "suborg-image-policy",
}));

const vps = fakeEnvironment({ name: "vps" });

const image = {
  service: "checkout",
  file: "services/checkout.json",
  digests: ["sha256:x"],
};

/** The services directory as the file system lists and reads it. */
function directory(files: Record<string, string>): void {
  vi.mocked(readdir).mockResolvedValue(
    Object.keys(files) as unknown as Awaited<ReturnType<typeof readdir>>,
  );
  vi.mocked(readFile).mockImplementation(async (path) => {
    const name = (path as string).split("/").pop()!;
    const text = files[name];
    if (text === undefined) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    return text;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(servicesDirectory).mockReturnValue("services");
  vi.mocked(applicationImagesOf).mockReturnValue([image]);
  vi.mocked(featureEnabled).mockReturnValue(true);
});

test("with suborg-image-policy off no record is read and there are no application images, so the repository is unchanged", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(await loadApplicationImages("/repo", vps)).toBeUndefined();
  expect(vi.mocked(featureEnabled).mock.calls).toStrictEqual([
    [vps, "suborg-image-policy"],
  ]);
  expect(vi.mocked(readdir).mock.calls).toStrictEqual([]);
  expect(vi.mocked(readFile).mock.calls).toStrictEqual([]);
});

test("each spec file is read with its release file beside it, by service name, and their images are what applicationImagesOf gives", async () => {
  directory({
    "payments.json": '{"spec":{"repository":"p"}}',
    "checkout.release.json": '{"spec":{"components":{}}}',
    "checkout.json": '{"spec":{"repository":"c"}}',
  });
  expect(await loadApplicationImages("/repo", vps)).toStrictEqual([image]);
  expect(vi.mocked(servicesDirectory).mock.calls).toStrictEqual([["vps"]]);
  expect(vi.mocked(readdir).mock.calls).toStrictEqual([["/repo/services"]]);
  expect(vi.mocked(applicationImagesOf).mock.calls).toStrictEqual([
    [
      [
        {
          service: "checkout",
          file: "services/checkout.json",
          spec: { spec: { repository: "c" } },
          release: { spec: { components: {} } },
        },
        {
          service: "payments",
          file: "services/payments.json",
          spec: { spec: { repository: "p" } },
          release: undefined,
        },
      ],
    ],
  ]);
});

test("a file that is not strict JSON is passed on as no manifest, so the record check alone reports it", async () => {
  directory({
    "checkout.json": "{ not json",
    "checkout.release.json": "{ not json either",
  });
  await loadApplicationImages("/repo", vps);
  expect(vi.mocked(applicationImagesOf).mock.calls).toStrictEqual([
    [
      [
        {
          service: "checkout",
          file: "services/checkout.json",
          spec: undefined,
          release: undefined,
        },
      ],
    ],
  ]);
});

test("an environment with no services directory has no application images", async () => {
  vi.mocked(readdir).mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  vi.mocked(applicationImagesOf).mockReturnValue([]);
  expect(await loadApplicationImages("/repo", vps)).toStrictEqual([]);
  expect(vi.mocked(applicationImagesOf).mock.calls).toStrictEqual([[[]]]);
});

test("a services directory that cannot be read for another reason fails, rather than admitting nothing silently", async () => {
  vi.mocked(readdir).mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(loadApplicationImages("/repo", vps)).rejects.toThrow("denied");
});
