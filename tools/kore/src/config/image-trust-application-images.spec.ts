// Docs: docs/decisions/0028-image-trust-authority.md
import { beforeEach, expect, test, vi } from "vitest";
import { applicationImageErrors } from "./application-images.js";
import { enrollmentExemptionErrors } from "./enrollment.js";
import { featureEnabled } from "./features.js";
import { imageTrustErrors } from "./image-trust.js";
import { registryPlan, type RegistryPlan } from "./registry-address.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
  fakeSeeds,
} from "./config-support.js";

// Issue 1556: kore validate reports the suborg-image-policy refusals with the image
// trust errors, before any cluster is touched.

// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./application-images.js", () => ({
  applicationImageErrors: vi.fn(),
}));
vi.mock("./enrollment.js", () => ({ enrollmentExemptionErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryPlan: vi.fn() }));
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  goldenPathTemplateAdmissionFlag: "golden-path-template-admission",
}));

beforeEach(() => {
  vi.mocked(enrollmentExemptionErrors).mockReturnValue([]);
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.example:5000",
  } as RegistryPlan);
});

test("the image trust errors end with the suborg-image-policy refusals, read from the same repository", () => {
  vi.mocked(applicationImageErrors).mockReturnValue(["application problem"]);
  const repository = fakeRepository({
    environment: fakeEnvironment({ name: "vps", provider: "managed" }),
    catalog: fakeCatalog([fakeComponent({ name: "kore-image-policy" })]),
    seeds: fakeSeeds([]),
    imageTrustValues: {
      trust: {
        type: "keyless",
        mode: "audit",
        issuer: "https://token.actions.githubusercontent.com",
        subjects: [
          "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.2.3",
        ],
      },
    },
  });
  expect(imageTrustErrors(repository)).toEqual([
    "image trust: mode must be warn or enforce (new environments start at warn; audit before enforce)",
    "application problem",
  ]);
  expect(vi.mocked(applicationImageErrors).mock.calls).toEqual([[repository]]);
});
