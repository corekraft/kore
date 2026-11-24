// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
import { expect, test } from "vitest";
import { fakeComponent, fakeRepository } from "./platform-support.js";
import { goldenPathArgs } from "./golden-path-args.js";

const golden = {
  repoURL: "https://github.com/corekraft/kore.git",
  revision: "a".repeat(40),
  environment: "local",
  templateImages: {
    "static-frontend": {
      image: "ghcr.io/o/fe",
      digest: `sha256:${"1".repeat(64)}`,
    },
    "kotlin-bff": {
      image: "ghcr.io/o/bff",
      digest: `sha256:${"2".repeat(64)}`,
    },
  },
  ingress: { platformDomain: "kore.internal", gatewayClassName: "istio" },
};

const goldenComponent = fakeComponent({ name: "kore-golden-path-delivery" });

test("with serviceRecords on, the golden-path arguments end with the serviceRecords pair, so the sync also applies the records", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, serviceRecords: true },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual(["--set", "serviceRecords=true"]);
});

test("with templateAdmission on, the golden-path arguments carry the templateAdmission pair, so the sync enrols the golden-path namespaces", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, templateAdmission: true },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual(["--set", "templateAdmission=true"]);
});

test("with templateAdmission off, the golden-path arguments carry no templateAdmission argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, templateAdmission: false },
    },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("templateAdmission"))).toBe(false);
});

test("with safetyDefaults on, the golden-path arguments end with the safetyDefaults pair, so the sync sets the workload defaults (ADR 0154)", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, safetyDefaults: true },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual(["--set", "safetyDefaults=true"]);
});

test("with safetyDefaults off, the golden-path arguments carry no safetyDefaults argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, safetyDefaults: false },
    },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("safetyDefaults"))).toBe(false);
});

test("with serviceIdentity on, the golden-path arguments end with the serviceIdentity pair, so the sync sets each workload's service identity (issue 1551)", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, serviceIdentity: true },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual(["--set", "serviceIdentity=true"]);
});

test("with serviceIdentity off, the golden-path arguments carry no serviceIdentity argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, serviceIdentity: false },
    },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("serviceIdentity"))).toBe(false);
});

test("with appDelivery on, the golden-path arguments end with the appDelivery pair, so the sync gives each Application its release file (ADR 0172)", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, appDelivery: true },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual(["--set", "appDelivery=true"]);
});

test("with appDelivery off, the golden-path arguments carry no appDelivery argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, appDelivery: false },
    },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("appDelivery"))).toBe(false);
});

test("with serviceRecords off, the golden-path arguments carry no serviceRecords argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, serviceRecords: false },
    },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("serviceRecords"))).toBe(false);
});

test("a component other than kore-golden-path-delivery gets no golden-path arguments, whatever serviceRecords says", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: { ...golden, serviceRecords: true },
    },
    fakeComponent({ name: "kore-platform-config" }),
  );
  expect(args).toEqual([]);
});

test("with golden-path-signin on, the arguments end with the issuer under signin, so the sync passes it to each workload", () => {
  const args = goldenPathArgs(
    {
      ...fakeRepository(),
      goldenPathDelivery: {
        ...golden,
        signin: { issuerUri: "https://keycloak.kore.internal/realms/platform" },
      },
    },
    goldenComponent,
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "signin.issuerUri=https://keycloak.kore.internal/realms/platform",
  ]);
});

test("with golden-path-signin off, the arguments carry no signin argument, so the flag-off render is unchanged", () => {
  const args = goldenPathArgs(
    { ...fakeRepository(), goldenPathDelivery: { ...golden } },
    goldenComponent,
  );
  expect(args.some((arg) => arg.includes("signin"))).toBe(false);
});
