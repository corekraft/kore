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

// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md

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

async function renderPrometheus(
  repository: Repository,
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
  const component = flagged.catalog.components.find(
    (c) => c.name === "prometheus",
  )!;
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
    "prometheus",
  );
  assert.ok(args.length > 0, "the flag and an address give arguments");
  const text = args.join("\n");
  assert.equal(text.includes(address), false);
  assert.equal(/@/.test(text), false);
});

test("the forwarding arguments exist exactly when platform-portal is on and an address is set, in every shipped environment", async () => {
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
    assert.deepEqual(alertForwardingHelmArgs(off, "prometheus"), [], name);
    assert.notEqual(alertForwardingHelmArgs(on, "prometheus").length, 0, name);
    withAddress(false);
    assert.deepEqual(alertForwardingHelmArgs(on, "prometheus"), [], name);
    assert.deepEqual(alertForwardingHelmArgs(off, "prometheus"), [], name);
  }
});

// Opt-in: it pulls the pinned Prometheus chart, and fast tests run offline
// (AGENTS.md). Run with `npm run test:upstream-charts` when bumping Prometheus.
const upstream = process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1";

test.runIf(upstream)(
  "the metrics store mounts the Service rules and forwards to Grafana only when platform-portal is on and an address is set, and is otherwise exactly as before",
  async () => {
    const repository = await loadRepository("local");
    withAddress(false);
    const baseline = await renderPrometheus(repository, false);
    assert.equal(baseline.includes("kore-service-rules"), false);
    assert.equal(baseline.includes("alertmanager/grafana"), false);
    assert.match(baseline, /\/etc\/kore\/rules\/platform\.yaml/);

    // The flag alone, with no address, changes nothing.
    assert.equal(await renderPrometheus(repository, true), baseline);

    // An address alone, with the flag off, changes nothing.
    withAddress(true);
    assert.equal(await renderPrometheus(repository, false), baseline);

    const on = await renderPrometheus(repository, true);
    assert.equal(on.includes(address), false);
    for (const needle of [
      "/etc/kore/service-rules/*.yaml",
      "--watched-dir=/etc/kore/service-rules",
      "name: kore-service-rules",
      "path_prefix: /api/alertmanager/grafana",
      "password_file: /etc/kore/grafana-admin/admin-password",
      "- grafana.observability.svc:80",
    ]) {
      assert.ok(on.includes(needle), `renders ${needle}`);
    }
    // The ConfigMap and the Secret are optional, so the metrics store, which
    // installs before Grafana and the rules chart, still becomes ready.
    assert.equal((on.match(/optional: true/g) ?? []).length, 2);
    // The platform rules and the chart's own files stay loaded.
    for (const file of [
      "/etc/config/recording_rules.yml",
      "/etc/config/alerting_rules.yml",
      "/etc/kore/rules/platform.yaml",
    ]) {
      assert.ok(on.includes(`- ${file}`), `keeps ${file}`);
    }
  },
  120_000,
);
