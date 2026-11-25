// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  applicationImageArgs,
  applicationImageErrors,
  applicationImagesOf,
  type ApplicationImage,
} from "./application-images.js";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import type { Repository } from "./types.js";

// Issue 1556: while suborg-image-policy is on, the image-policy chart takes each app
// record with a release (service, repository, release digests), renders one enforce
// policy per record, and kore validate refuses what the policy could never admit.

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  suborgImagePolicyFlag: "suborg-image-policy",
}));

const frontend = `sha256:${"a".repeat(64)}`;
const bff = `sha256:${"b".repeat(64)}`;
const file = "infra/environments/vps/services/checkout.json";

const checkout: ApplicationImage = {
  service: "checkout",
  file,
  repository: "github.com/example-org/checkout",
  digests: [frontend, bff],
};

type Fields = Pick<
  Repository,
  "environment" | "imageTrustValues" | "applicationImages"
>;

/** A repository with only the fields the application image checks read. */
function repository(fields: Partial<Fields> = {}): Fields {
  return {
    environment: fakeEnvironment({ name: "vps" }),
    imageTrustValues: { trust: { type: "keyless" } },
    applicationImages: [checkout],
    ...fields,
  };
}

const release = (components: Record<string, unknown>) => ({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "ServiceRelease",
  metadata: { name: "checkout" },
  spec: { commit: "c".repeat(40), components },
});

const spec = (fields: Record<string, unknown>) => ({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Service",
  metadata: { name: "checkout" },
  spec: fields,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
});

test("with suborg-image-policy on, the image-policy chart takes each record's service, repository and release digests, and not the record's file", () => {
  expect(applicationImageArgs(repository(), "kore-image-policy")).toStrictEqual(
    [
      "--set-json",
      `applicationImages=[{"service":"checkout","repository":"github.com/example-org/checkout","digests":["${frontend}","${bff}"]}]`,
    ],
  );
});

test("with suborg-image-policy on and no record, the chart takes an empty list, so it renders no application policy", () => {
  expect(
    applicationImageArgs(
      repository({ applicationImages: [] }),
      "kore-image-policy",
    ),
  ).toStrictEqual(["--set-json", "applicationImages=[]"]);
});

test("with suborg-image-policy off the image-policy chart takes no application images, so its render is unchanged", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(applicationImageArgs(repository(), "kore-image-policy")).toStrictEqual(
    [],
  );
});

test("only the image-policy chart takes the application images, not any other component", () => {
  expect(
    applicationImageArgs(repository(), "kore-platform-apis"),
  ).toStrictEqual([]);
});

test("the flag read is suborg-image-policy on the repository's environment", () => {
  const fields = repository();
  applicationImageArgs(fields, "kore-image-policy");
  expect(vi.mocked(featureEnabled).mock.calls).toStrictEqual([
    [fields.environment, "suborg-image-policy"],
  ]);
});

test("with suborg-image-policy off nothing is refused, whatever the trust and records", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    applicationImageErrors(
      repository({
        imageTrustValues: { trust: { type: "key" } },
        applicationImages: [{ service: "checkout", file, digests: [frontend] }],
      }),
    ),
  ).toStrictEqual([]);
});

test("with suborg-image-policy on, a keyless trust and a record on github.com, nothing is refused", () => {
  expect(applicationImageErrors(repository())).toStrictEqual([]);
});

test("with suborg-image-policy on, a key trust is refused, naming the flag, the overlay and the fix", () => {
  expect(
    applicationImageErrors(
      repository({ imageTrustValues: { trust: { type: "key" } } }),
    ),
  ).toStrictEqual([
    "image trust: suborg-image-policy needs a keyless trust (the platform workflow identity) in the kore-image-policy values overlay of environment vps; set trust.type keyless, or turn suborg-image-policy off",
  ]);
});

test("with suborg-image-policy on and no trust at all, only the existing trust check speaks, so the refusal is not doubled", () => {
  expect(
    applicationImageErrors(repository({ imageTrustValues: undefined })),
  ).toStrictEqual([]);
});

test("with suborg-image-policy on, a record with release digests and no repository is refused, naming its file and the fix", () => {
  expect(
    applicationImageErrors(
      repository({
        applicationImages: [{ service: "checkout", file, digests: [frontend] }],
      }),
    ),
  ).toStrictEqual([
    `${file}: suborg-image-policy admits a record's images only when the platform workflow signed them from the record's repository; set spec.repository (github.com/<owner>/<name>), or turn suborg-image-policy off`,
  ]);
});

test("with suborg-image-policy on, a repository off github.com, or with more than an owner and a name, is refused", () => {
  for (const bad of [
    "example.org/leads/checkout",
    "github.com/example-org",
    "github.com/example-org/checkout/extra",
    "https://github.com/example-org/checkout",
  ]) {
    expect(
      applicationImageErrors(
        repository({ applicationImages: [{ ...checkout, repository: bad }] }),
      ),
    ).toStrictEqual([
      `${file}: repository ${bad} is not github.com/<owner>/<name>; suborg-image-policy binds an image to the GitHub repository its platform workflow ran in, so set spec.repository to github.com/<owner>/<name>, or turn suborg-image-policy off`,
    ]);
  }
});

test("a record's images are its release digests, frontend first, with the spec's repository and the spec file", () => {
  expect(
    applicationImagesOf([
      {
        service: "checkout",
        file,
        spec: spec({ repository: "github.com/example-org/checkout" }),
        release: release({
          bff: { digest: bff },
          frontend: { digest: frontend },
        }),
      },
    ]),
  ).toStrictEqual([checkout]);
});

test("a record whose spec names no repository keeps its digests and no repository, so validation can name it", () => {
  expect(
    applicationImagesOf([
      {
        service: "checkout",
        file,
        spec: spec({}),
        release: release({ frontend: { digest: frontend } }),
      },
    ]),
  ).toStrictEqual([{ service: "checkout", file, digests: [frontend] }]);
});

test("a record with no release, or a release with no digest, has no application image", () => {
  expect(
    applicationImagesOf([
      {
        service: "checkout",
        file,
        spec: spec({ repository: "github.com/example-org/checkout" }),
        release: undefined,
      },
      {
        service: "payments",
        file: "infra/environments/vps/services/payments.json",
        spec: spec({ repository: "github.com/example-org/payments" }),
        release: release({ frontend: {} }),
      },
    ]),
  ).toStrictEqual([]);
});
