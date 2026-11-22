import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, test } from "vitest";
import {
  alertForwardingHelmArgs,
  loadRepository,
} from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";

// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md

const run = promisify(execFile);
const address = "ops@example.invalid";
const operatorSettings = {
  KORE_ALERT_EMAIL_ADDRESSES: address,
  KORE_ALERT_SMTP_HOST: "smtp.example.invalid",
  KORE_ALERT_SMTP_PORT: "587",
  KORE_ALERT_SMTP_FROM: "kore@example.invalid",
};
const settingNames = Object.keys(operatorSettings);

afterEach(() => {
  for (const name of settingNames) {
    delete process.env[name];
  }
});

function withAddress(present: boolean): void {
  for (const [name, value] of Object.entries(operatorSettings)) {
    if (present) {
      process.env[name] = value;
    } else {
      delete process.env[name];
    }
  }
}

async function renderComponent(
  repository: Repository,
  name: string,
  portal: boolean,
): Promise<string> {
  const flagged: Repository = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-portal": portal,
      },
    },
  };
  const component = flagged.catalog.components.find((c) => c.name === name)!;
  const { stdout } = await run(
    "helm",
    withAbsoluteChart(flagged, component, helmTemplateArgs(flagged, component)),
    { maxBuffer: 64 * 1024 * 1024, ...envOption(helmEnv(flagged, component)) },
  );
  return stdout;
}

test("the forwarding arguments hold no address, whatever the operator supplies, so the public repository and every rendered release stay free of it", async () => {
  withAddress(true);
  const repository = await loadRepository("local");
  const args = alertForwardingHelmArgs(
    {
      ...repository.environment,
      features: { ...repository.environment.features, "platform-portal": true },
    },
    "grafana",
  );
  assert.ok(args.length > 0, "the flag and an address give arguments");
  const text = args.join("\n");
  assert.equal(text.includes(address), false);
  assert.equal(/@/.test(text), false);
});

test("the alerting sidecar arguments exist only for Grafana, exactly when platform-portal is on and an address is set, in every shipped environment", async () => {
  for (const name of ["local", "managed-example"]) {
    const { environment } = await loadRepository(name);
    const on = {
      ...environment,
      features: { ...environment.features, "platform-portal": true },
    };
    const off = {
      ...environment,
      features: { ...environment.features, "platform-portal": false },
    };
    withAddress(true);
    assert.deepEqual(alertForwardingHelmArgs(off, "grafana"), [], name);
    assert.notEqual(alertForwardingHelmArgs(on, "grafana").length, 0, name);
    assert.deepEqual(alertForwardingHelmArgs(on, "prometheus"), [], name);
    withAddress(false);
    assert.deepEqual(alertForwardingHelmArgs(on, "grafana"), [], name);
    assert.deepEqual(alertForwardingHelmArgs(off, "grafana"), [], name);
  }
});

// Opt-in: it pulls the pinned Prometheus and Grafana charts, and fast tests run
// offline (AGENTS.md). Run with `npm run test:upstream-charts` when bumping them.
const upstream = process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1";

test.runIf(upstream)(
  "the metrics store renders exactly as before with platform-portal on and an address set: it loads no Service rules, lists no Alertmanager and mounts no Grafana credential",
  async () => {
    const repository = await loadRepository("local");
    withAddress(false);
    const baseline = await renderComponent(repository, "prometheus", false);
    assert.equal(baseline.includes("kore-service-rules"), false);
    assert.equal(baseline.includes("alertmanager/grafana"), false);
    assert.equal(baseline.includes("grafana-admin"), false);
    assert.match(baseline, /\/etc\/kore\/rules\/platform\.yaml/);

    withAddress(true);
    assert.equal(
      await renderComponent(repository, "prometheus", true),
      baseline,
    );
  },
);

test.runIf(upstream)(
  "Grafana loads the Service alert rules through its alerting sidecar only when platform-portal is on and an address is set",
  async () => {
    const repository = await loadRepository("local");
    withAddress(false);
    const portalOnly = await renderComponent(repository, "grafana", true);
    assert.equal(portalOnly.includes("grafana_alert"), false);

    withAddress(true);
    const on = await renderComponent(repository, "grafana", true);
    assert.equal(on.includes(address), false);
    for (const needle of [
      "grafana_alert",
      "/etc/grafana/provisioning/alerting",
    ]) {
      assert.ok(on.includes(needle), `renders ${needle}`);
    }
    assert.equal(on.includes("/etc/kore/grafana-admin"), false);
  },
);
