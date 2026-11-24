import { expect, test } from "vitest";
import { dataPathGuaranteedQosFlag, valuesGatedOff } from "./features.js";
import { fakeComponent, fakeEnvironment } from "./config-support.js";

// Issue 1593: a value file that carries only a flag's numbers is passed to Helm only while that flag is on.

const gated = "infra/environments/common/values/policy-controller-qos.yaml";
const ungated = "infra/environments/common/values/policy-controller.yaml";

const component = fakeComponent({
  name: "policy-controller",
  valuesFlags: { [gated]: dataPathGuaranteedQosFlag },
});

test("a value file its flag gates is skipped while the flag is off, and kept once the flag is on", () => {
  expect(
    valuesGatedOff(
      fakeEnvironment({ features: { [dataPathGuaranteedQosFlag]: false } }),
      component,
      gated,
    ),
  ).toBe(true);
  expect(
    valuesGatedOff(
      fakeEnvironment({ features: { [dataPathGuaranteedQosFlag]: true } }),
      component,
      gated,
    ),
  ).toBe(false);
});

test("a value file no flag gates is never skipped, whatever the flags are", () => {
  const environment = fakeEnvironment({
    features: { [dataPathGuaranteedQosFlag]: false },
  });
  expect(valuesGatedOff(environment, component, ungated)).toBe(false);
  expect(valuesGatedOff(environment, fakeComponent(), gated)).toBe(false);
});
