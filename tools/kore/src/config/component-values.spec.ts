import { expect, test } from "vitest";
import { componentValues } from "./component-values.js";
import {
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
} from "./config-support.js";

// Issue 1593: a value file its flag gates reaches Helm only while that flag is on.

test("a value file its flag gates reaches Helm only while the flag is on, between the component's own and the environment's", () => {
  const gated = "infra/environments/common/values/policy-controller-qos.yaml";
  const component = fakeComponent({
    name: "policy-controller",
    values: ["infra/environments/common/values/policy-controller.yaml", gated],
    valuesFlags: { [gated]: "data-path-guaranteed-qos" },
  });
  const environment = (on: boolean) =>
    fakeRepository({
      environment: fakeEnvironment({
        features: { "data-path-guaranteed-qos": on },
        componentValues: {
          "policy-controller": ["infra/environments/local/values/pc.yaml"],
        },
      }),
    });
  expect(componentValues(environment(false), component)).toEqual([
    "infra/environments/common/values/policy-controller.yaml",
    "infra/environments/local/values/pc.yaml",
  ]);
  expect(componentValues(environment(true), component)).toEqual([
    "infra/environments/common/values/policy-controller.yaml",
    gated,
    "infra/environments/local/values/pc.yaml",
  ]);
});
