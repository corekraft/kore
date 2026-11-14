// Docs: docs/decisions/0059-identity-policy-evidence.md
import { expect, test, vi } from "vitest";
import { fakeRepository } from "./config-support.js";
import { imageTrustErrors } from "./image-trust.js";
import { policyErrors } from "./policy-validation.js";
import { policyPromotionErrors } from "./policy-promotion.js";

vi.mock("./image-trust.js");
vi.mock("./policy-promotion.js");

test("image trust errors are listed before promotion errors", async () => {
  vi.mocked(imageTrustErrors).mockReturnValue(["trust: unsigned signer"]);
  vi.mocked(policyPromotionErrors).mockResolvedValue(["promotion: no record"]);
  expect(await policyErrors(fakeRepository())).toEqual([
    "trust: unsigned signer",
    "promotion: no record",
  ]);
});

test("a clean image trust check reports only the promotion errors", async () => {
  vi.mocked(imageTrustErrors).mockReturnValue([]);
  vi.mocked(policyPromotionErrors).mockResolvedValue(["promotion: no record"]);
  expect(await policyErrors(fakeRepository())).toEqual([
    "promotion: no record",
  ]);
});

test("both checks read the same repository", async () => {
  const repository = fakeRepository({ root: "/repo" });
  vi.mocked(imageTrustErrors).mockReturnValue([]);
  vi.mocked(policyPromotionErrors).mockResolvedValue([]);
  await policyErrors(repository);
  expect(imageTrustErrors).toHaveBeenCalledExactlyOnceWith(repository);
  expect(policyPromotionErrors).toHaveBeenCalledExactlyOnceWith(repository);
});

test("a promotion check that cannot read the policies fails validation rather than passing it", async () => {
  vi.mocked(imageTrustErrors).mockReturnValue([]);
  vi.mocked(policyPromotionErrors).mockRejectedValue(new Error("EACCES"));
  await expect(policyErrors(fakeRepository())).rejects.toThrow("EACCES");
});
