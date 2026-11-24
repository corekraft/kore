import { expect, test } from "vitest";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { k3sPinErrors } from "./k3s-pin.js";

const vpsCluster = (kubernetesVersion: string) =>
  fakeEnvironment({
    name: "vps",
    provider: "managed",
    kubeContext: "kore-vps",
    cluster: {
      profile: "external",
      kubernetesVersion,
      driver: "external",
      containerRuntime: "containerd",
      cpus: 4,
      memoryMB: 20480,
      diskSize: "300g",
    },
  });

test("a k3s pin one minor ahead of the vps overlay fails, naming both versions and the pull request rule", () => {
  const errors = k3sPinErrors(
    fakeRepository({
      environment: vpsCluster("1.37.2"),
      k3sHostPin: "v1.38.2+k3s1",
    }),
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("v1.38.2+k3s1");
  expect(errors[0]).toContain("1.37.2");
  expect(errors[0]).toContain("same pull request");
});

test("a k3s pin equal to the vps overlay's Kubernetes version passes", () => {
  expect(
    k3sPinErrors(
      fakeRepository({
        environment: vpsCluster("1.37.2"),
        k3sHostPin: "v1.37.2+k3s1",
      }),
    ),
  ).toEqual([]);
});

test("a k3s pin differing only in its patch version fails, since the versions disagree", () => {
  expect(
    k3sPinErrors(
      fakeRepository({
        environment: vpsCluster("1.37.2"),
        k3sHostPin: "v1.37.3+k3s1",
      }),
    ),
  ).toHaveLength(1);
});

test("a k3s pin that is not a k3s release fails, naming the value so the author can fix it", () => {
  const errors = k3sPinErrors(
    fakeRepository({
      environment: vpsCluster("1.37.2"),
      k3sHostPin: "latest",
    }),
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("latest");
});

test("the k3s pin is checked against the vps overlay only, so another overlay with a pin loaded passes", () => {
  expect(
    k3sPinErrors(
      fakeRepository({
        environment: fakeEnvironment({ name: "managed-example" }),
        k3sHostPin: "v1.38.2+k3s1",
      }),
    ),
  ).toEqual([]);
});

test("with no k3s pin loaded there is nothing to compare, so no error", () => {
  expect(
    k3sPinErrors(fakeRepository({ environment: vpsCluster("1.37.2") })),
  ).toEqual([]);
});
