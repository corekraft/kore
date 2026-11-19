import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  ingressFlag,
  loadRepository,
  validateRepository,
  type Repository,
} from "../../src/config/index.js";
import {
  generatedPorts,
  merge,
  overlayPorts,
  render,
} from "./gateway-service-support.js";

// Docs: docs/decisions/0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md

// The flag that adds the passthrough listener on 5432, its Service port and the loopback mapping.
const databaseRoutesFlag = "database-routes";

function withDatabaseRoutes(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [databaseRoutesFlag]: on,
      },
    },
  };
}

function withClass(repository: Repository, gatewayClass: string): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [ingressFlag]: gatewayClass === "agentgateway",
      },
    },
  };
}

const postgresPort = 5432;

test.each(["agentgateway", "istio"])(
  "with database-routes off the %s Gateway renders no passthrough listener, Service port or node port, exactly as it rendered before the flag existed",
  async (gatewayClass) => {
    const base = withClass(await loadRepository("local"), gatewayClass);
    const off = render(withDatabaseRoutes(base, false));
    const { [databaseRoutesFlag]: _declared, ...features } =
      base.environment.features ?? {};
    const undeclared = render({
      ...base,
      environment: { ...base.environment, features },
    });
    assert.equal(off, undeclared);
    assert.doesNotMatch(off, /5432|Passthrough|postgres|protocol: TLS/);
    assert.doesNotMatch(off, new RegExp(`nodePort: 30432`));
  },
);

test.each(["agentgateway", "istio"])(
  "with database-routes on the %s Gateway, its Service port, node port and the loopback mapping agree on 5432",
  async (gatewayClass) => {
    const repository = withDatabaseRoutes(
      withClass(await loadRepository("local"), gatewayClass),
      true,
    );
    const output = render(repository);
    const { domain, organizationId } = repository.environment.platform;
    const wildcard = `*.${organizationId}.${domain}`.replace(/[.*]/g, "\\$&");
    assert.match(
      output,
      new RegExp(
        `- name: postgres\\s+hostname: "${wildcard}"\\s+port: ${postgresPort}\\s+protocol: TLS\\s+tls:\\s+mode: Passthrough\\s+allowedRoutes:`,
      ),
    );
    const mapping = repository.environment.k3d?.ports.find(
      (p) => p.hostPort === postgresPort,
    );
    assert.ok(mapping, "the k3d block maps host port 5432");
    assert.equal(mapping.hostAddress, "127.0.0.1");
    assert.equal(mapping.featureFlag, databaseRoutesFlag);
    const published = overlayPorts(output).find((p) => p.port === postgresPort);
    assert.deepEqual(published, {
      name: "postgres",
      port: postgresPort,
      nodePort: mapping.loadBalancerPort,
    });
    const merged = merge(
      generatedPorts(
        gatewayClass,
        repository.environment.gateway.port,
        postgresPort,
      ),
      overlayPorts(output),
    );
    assert.deepEqual(
      merged.filter((p) => !p.name),
      [],
      "every Service port needs a name once the Service has more than one",
    );
    assert.equal(
      new Set(merged.map((p) => p.name)).size,
      merged.length,
      "port names are unique",
    );
    assert.equal(
      merged.filter((p) => p.port === postgresPort).length,
      1,
      "one Service port serves the listener",
    );
  },
);

test("the 5432 mapping is declared in the overlay, on loopback, behind the flag, and the overlay validates with it", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  const mappings = (repository.environment.k3d?.ports ?? []).filter(
    (p) => p.hostPort === postgresPort,
  );
  assert.deepEqual(
    mappings.map(({ hostAddress, protocol, featureFlag, optOut }) => ({
      hostAddress,
      protocol,
      featureFlag,
      optOut,
    })),
    [
      {
        hostAddress: "127.0.0.1",
        protocol: undefined,
        featureFlag: databaseRoutesFlag,
        optOut: undefined,
      },
    ],
  );
  assert.equal(repository.environment.features?.[databaseRoutesFlag], false);
});

test("database-routes is off in every overlay", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[databaseRoutesFlag],
      false,
      name,
    );
  }
});

test("an environment with no Gateway service renders the passthrough listener without a Service overlay when database-routes is on", async () => {
  const repository = withDatabaseRoutes(
    await loadRepository("managed-example"),
    true,
  );
  const output = render(repository);
  assert.match(output, /- name: postgres/);
  assert.doesNotMatch(output, /NodePort|parametersRef|nodePort/);
});

test("the platform chart names no k3d and no host address for the database listener", async () => {
  const repository = await loadRepository("local");
  const chart = `${repository.root}/infra/charts/platform-config`;
  for (const file of ["values.yaml", "templates/gateway.yaml"]) {
    assert.doesNotMatch(
      await readFile(`${chart}/${file}`, "utf8"),
      /k3d|127\.0\.0\.1/i,
    );
  }
});
