// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Spec #1612: the environment declares an internal Gateway and an optional external one.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  internalGateway,
  loadRepository,
  validateRepository,
  type Environment,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { validationMessage } from "../../src/testing/index.js";

type Platform = Environment["platform"];
type Gateways = NonNullable<Environment["gateways"]>;
type Gateway = NonNullable<Environment["gateway"]>;

/** The loaded environment with its platform and Gateway fields replaced; everything else is kept. */
function declare(
  base: Environment,
  fields: { platform: Platform; gateway?: Gateway; gateways?: Gateways },
): Environment {
  const { gateway: _single, gateways: _declared, platform: _p, ...rest } = base;
  return {
    ...rest,
    platform: fields.platform,
    ...(fields.gateway === undefined ? {} : { gateway: fields.gateway }),
    ...(fields.gateways === undefined ? {} : { gateways: fields.gateways }),
  };
}

const example: Platform = { domain: "example.com", organizationId: "platform" };
const internal = {
  namespace: "kore-system",
  name: "kore-gateway",
  port: 443,
  issuer: "kore-local-ca",
};
const external = {
  namespace: "kore-system",
  name: "kore-gateway-external",
  port: 443,
  issuer: "acme-production",
};

test("the shipped local, vps and managed-example overlays declare the internal Gateway and load", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const { environment } = await loadRepository(name);
    const declared = environment.gateways?.internal;
    assert.ok(declared, `${name} declares gateways.internal`);
    const { issuer, ...entry } = declared;
    assert.ok(issuer.length > 0, `${name} names the internal issuer`);
    assert.deepEqual(entry, environment.gateway);
    assert.deepEqual(internalGateway(environment), declared);
  }
});

test("a fixture with only the single gateway field and one with only gateways.internal validate and render the same Helm arguments", async () => {
  const base = await loadRepository("local");
  const { gateway, gateways, ...rest } = base.environment;
  const entry = gateways?.internal;
  assert.ok(gateway, "the local overlay keeps the single gateway field");
  assert.ok(entry, "the local overlay declares gateways.internal");
  const singleOnly: Repository = {
    ...base,
    environment: { ...rest, gateway },
  };
  const internalOnly: Repository = {
    ...base,
    environment: { ...rest, gateways: { internal: entry } },
  };
  await validateRepository(singleOnly);
  await validateRepository(internalOnly);
  for (const component of base.catalog.components) {
    if (component.kind === "manifest") {
      continue;
    }
    assert.deepEqual(
      helmTemplateArgs(internalOnly, component),
      helmTemplateArgs(singleOnly, component),
      `${component.name} renders the same arguments either way`,
    );
  }
});

test("the local platform names keep their values with the internal Gateway declared", async () => {
  const repository = await loadRepository("local");
  const platformConfig = repository.catalog.components.find(
    (component) => component.name === "kore-platform-config",
  );
  assert.ok(platformConfig);
  const args = helmTemplateArgs(repository, platformConfig);
  assert.ok(args.includes("gateway.hostname=kore.internal"));
  assert.ok(args.includes("gateway.platformHostname=*.platform.kore.internal"));
});

test("a valid external Gateway under the internal domain validates and leaves the rendered arguments unchanged", async () => {
  const base = await loadRepository("local");
  const entry = base.environment.gateways?.internal;
  assert.ok(entry, "the local overlay declares gateways.internal");
  const withExternal: Repository = {
    ...base,
    environment: declare(base.environment, {
      platform: {
        domain: "kore.internal",
        organizationId: "platform",
        internalDomain: "internal.kore.internal",
      },
      gateways: { internal: entry, external },
    }),
  };
  await validateRepository(withExternal);
  for (const component of base.catalog.components) {
    if (component.kind === "manifest") {
      continue;
    }
    assert.deepEqual(
      helmTemplateArgs(withExternal, component),
      helmTemplateArgs(base, component),
      `${component.name} renders the same arguments with an external Gateway declared`,
    );
  }
});

test("an external Gateway with no internal domain is refused with the field and the fix", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    environment: declare(base.environment, {
      platform: example,
      gateways: { internal, external },
    }),
  }));
  assert.ok(
    message.includes(
      "platform.internalDomain is required when gateways.external is declared: set it to internal.example.com in environment local",
    ),
    message,
  );
});

test("an internal domain that is not internal. under the platform domain is refused with the value read", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    environment: declare(base.environment, {
      platform: { ...example, internalDomain: "example.com" },
      gateways: { internal, external },
    }),
  }));
  assert.ok(
    message.includes(
      'platform.internalDomain must be internal.example.com when gateways.external is declared, in environment local, got "example.com"',
    ),
    message,
  );
});

test("an external Gateway with no internal Gateway is refused, naming gateways.internal", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    environment: declare(base.environment, {
      platform: { ...example, internalDomain: "internal.example.com" },
      gateways: { external },
    }),
  }));
  assert.ok(
    message.includes(
      "gateways.internal is required when gateways is declared; add gateways.internal with name, namespace, port and issuer",
    ),
    message,
  );
});

test("a declared internal domain with no external Gateway is refused unless it is the platform domain", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    environment: declare(base.environment, {
      platform: { ...example, internalDomain: "internal.example.com" },
      gateways: { internal },
    }),
  }));
  assert.ok(
    message.includes(
      'platform.internalDomain must equal platform.domain (example.com) when gateways.external is not declared, in environment local, got "internal.example.com"',
    ),
    message,
  );
});
