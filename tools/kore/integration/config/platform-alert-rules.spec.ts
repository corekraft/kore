import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "vitest";
import {
  alertDocument,
  alertFile,
  allRules,
  certificateFlag,
  chartDir,
  chartWithoutAlerts,
  configMapName,
  externalDnsFlag,
  render,
  renderWithBothFlags,
  ruleTitles,
} from "./platform-alert-rules-support.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md

test("with both flags off the chart renders byte-identical to main, which has no platform alert template", async () => {
  const chart = await chartDir();
  const without = await chartWithoutAlerts(chart);
  try {
    const off = JSON.stringify({
      features: { [externalDnsFlag]: false, [certificateFlag]: false },
    });
    assert.equal(await render(chart, off), await render(without, off));
    assert.equal(await render(chart), await render(without));
    assert.equal(
      (await render(chart, off)).includes(configMapName),
      false,
      "no platform alert ConfigMap with the flags off",
    );
  } finally {
    await rm(without, { recursive: true, force: true });
  }
});

test("the external-dns flag alone renders the sync-error rule, and the acme-dns01 flag alone renders the two certificate rules", async () => {
  const chart = await chartDir();
  const dns = await render(
    chart,
    JSON.stringify({ features: { [externalDnsFlag]: true } }),
  );
  assert.deepEqual(ruleTitles(dns), ["ExternalDNSSyncErrors"]);
  assert.deepEqual(
    alertFile(dns).groups.map((g) => g.name),
    ["kore.platform.external-dns"],
  );
  const certs = await render(
    chart,
    JSON.stringify({ features: { [certificateFlag]: true } }),
  );
  assert.deepEqual(ruleTitles(certs), [
    "CertificateNotReady",
    "CertificateNearExpiry",
  ]);
  assert.deepEqual(
    alertFile(certs).groups.map((g) => g.name),
    ["kore.platform.certificates"],
  );
});

test("with both flags on the three rules render in Grafana's alerting file, in the Kore folder, labelled for its sidecar", async () => {
  const rendered = await renderWithBothFlags();
  const doc = alertDocument(rendered);
  assert.ok(doc);
  assert.match(doc, /grafana_alert: "1"/);
  assert.equal(doc.includes("kind: PrometheusRule"), false);
  const file = alertFile(rendered);
  assert.equal(file.apiVersion, 1);
  assert.deepEqual(
    file.groups.map((g) => ({
      orgId: g.orgId,
      name: g.name,
      folder: g.folder,
      interval: g.interval,
    })),
    [
      {
        orgId: 1,
        name: "kore.platform.external-dns",
        folder: "Kore",
        interval: "1m",
      },
      {
        orgId: 1,
        name: "kore.platform.certificates",
        folder: "Kore",
        interval: "1m",
      },
    ],
  );
  assert.deepEqual(ruleTitles(rendered), [
    "ExternalDNSSyncErrors",
    "CertificateNotReady",
    "CertificateNearExpiry",
  ]);
});

test("every platform rule is notify-only, queries the Prometheus datasource, and carries no destination of its own", async () => {
  const rendered = await renderWithBothFlags();
  for (const rule of allRules(rendered)) {
    assert.equal(rule.condition, "C", rule.title);
    assert.equal(rule.noDataState, "OK", rule.title);
    assert.equal(rule.execErrState, "Error", rule.title);
    assert.equal(rule.labels.enforcement, "notify-only", rule.title);
    assert.ok(rule.labels.severity, rule.title);
    assert.deepEqual(
      Object.keys(rule.labels).sort(),
      ["enforcement", "severity"],
      `${rule.title} carries no contact point or other destination label`,
    );
    assert.deepEqual(Object.keys(rule.annotations), ["summary"], rule.title);
    const query = rule.data.find((d) => d.refId === "A");
    assert.equal(query?.datasourceUid, "prometheus", rule.title);
  }
  assert.equal(rendered.includes("kind: Secret"), false);
  assert.equal(rendered.includes("contact_point"), false);
});

test("no platform alert names a domain or a host: the rules carry no domain value", async () => {
  const doc = alertDocument(await renderWithBothFlags()) ?? "";
  assert.equal(doc.includes("example"), false);
  assert.equal(/https?:\/\//.test(doc), false);
  assert.equal(
    /[A-Za-z0-9-]+\.(com|net|org|io|dev|internal)\b/.test(doc),
    false,
  );
});
