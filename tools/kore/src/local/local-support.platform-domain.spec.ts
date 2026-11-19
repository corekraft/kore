import { describe, expect, it } from "vitest";
import {
  builtImage,
  digest,
  fakeRepository,
  signedLocalLock,
} from "./local-support.js";

describe("local fixtures name their registry on the platform domain they are given", () => {
  it("signs the local image lock with the registry of the injected domain", () => {
    expect(JSON.parse(signedLocalLock("example.com"))).toEqual({
      version: 1,
      authorizedSigners: ["local-kore-key"],
      entries: {
        reference: {
          image: "registry.example.com:30500/reference",
          digest,
          signer: "local-kore-key",
        },
      },
    });
  });

  it("keeps the signed local image lock on the kore.local registry by default", () => {
    expect(JSON.parse(signedLocalLock()).entries.reference.image).toBe(
      "registry.kore.local:30500/reference",
    );
  });

  it("builds an application's reference on the registry of the injected domain", () => {
    expect(builtImage("catalog", "example.com").image.reference).toBe(
      `registry.example.com:30500/catalog@${digest}`,
    );
  });

  it("gives a fake local repository the registry and telemetry of the platform domain it declares", () => {
    const { environment } = fakeRepository({
      platform: { domain: "example.com", organizationId: "platform" },
    });

    expect(environment.registry).toEqual({
      address: "registry.example.com:30500",
    });
    expect(environment.telemetry).toEqual({
      otlpEndpoint: "http://otel.example.com:4318",
    });
  });

  it("keeps a fake local repository on kore.local when it declares no platform domain", () => {
    const { environment } = fakeRepository();

    expect(environment.registry).toEqual({
      address: "registry.kore.local:30500",
    });
    expect(environment.telemetry).toEqual({
      otlpEndpoint: "http://otel.kore.local:4318",
    });
  });

  it("does not let a platform domain overwrite an explicitly declared registry address", () => {
    const { environment } = fakeRepository({
      platform: { domain: "example.com", organizationId: "platform" },
      registry: { address: "10.96.0.50:5000" },
    });

    expect(environment.registry).toEqual({ address: "10.96.0.50:5000" });
  });
});
