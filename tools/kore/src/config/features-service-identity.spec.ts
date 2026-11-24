// Context: issue #1551. The golden-path-service-identity flag renders each service's Service,
// ServiceAccount and pod identity; it is off while an overlay omits it.
import { expect, test } from "vitest";
import { featureEnabled, goldenPathServiceIdentityFlag } from "./features.js";
import { fakeEnvironment } from "./config-support.js";

test("the service identity flag is named golden-path-service-identity and is off while an overlay omits it (issue 1551)", () => {
  expect(goldenPathServiceIdentityFlag).toBe("golden-path-service-identity");
  expect(
    featureEnabled(fakeEnvironment({}), goldenPathServiceIdentityFlag),
  ).toBe(false);
  expect(
    featureEnabled(
      fakeEnvironment({ features: { [goldenPathServiceIdentityFlag]: true } }),
      goldenPathServiceIdentityFlag,
    ),
  ).toBe(true);
});
