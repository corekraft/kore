import assert from "node:assert/strict";
import { test } from "vitest";
import {
  allRules,
  renderWithBothFlags,
  runPromtool,
} from "./platform-alert-rules-support.js";

// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md

/** The rendered rules keyed by title, for the proof below. */
const ruleByTitle = async (title: string) => {
  const rule = allRules(await renderWithBothFlags()).find(
    (r) => r.title === title,
  );
  assert.ok(rule, `${title} is rendered`);
  return rule;
};

test("the sync-error rule fires when external-dns keeps reporting errors past fifteen minutes, and stays quiet on a healthy series", async () => {
  const sync = await ruleByTitle("ExternalDNSSyncErrors");
  const errors = "external_dns_controller_consecutive_soft_errors";
  await runPromtool(
    [sync],
    [
      {
        interval: "1m",
        name: "sync errors persist past fifteen minutes and fire",
        input_series: [{ series: errors, values: "0+0x5 3+0x20" }],
        alert_rule_test: [
          {
            eval_time: "20m",
            alertname: "ExternalDNSSyncErrors",
            exp_alerts: [],
          },
          {
            eval_time: "26m",
            alertname: "ExternalDNSSyncErrors",
            exp_alerts: [
              {
                exp_labels: { severity: "warning", enforcement: "notify-only" },
                exp_annotations: sync.annotations,
              },
            ],
          },
        ],
      },
      {
        interval: "1m",
        name: "a healthy external-dns stays quiet",
        input_series: [{ series: errors, values: "0+0x30" }],
        alert_rule_test: [
          {
            eval_time: "26m",
            alertname: "ExternalDNSSyncErrors",
            exp_alerts: [],
          },
        ],
      },
    ],
  );
});

test("the not-Ready rule fires when a certificate stays not Ready past fifteen minutes, and stays quiet when it is Ready", async () => {
  const notReady = await ruleByTitle("CertificateNotReady");
  const ready =
    'certmanager_certificate_ready_status{name="shop-tls",namespace="platform",condition="True"}';
  await runPromtool(
    [notReady],
    [
      {
        interval: "1m",
        name: "a certificate that is not Ready fires after fifteen minutes",
        input_series: [{ series: ready, values: "0+0x40" }],
        alert_rule_test: [
          {
            eval_time: "10m",
            alertname: "CertificateNotReady",
            exp_alerts: [],
          },
          {
            eval_time: "20m",
            alertname: "CertificateNotReady",
            exp_alerts: [
              {
                exp_labels: {
                  name: "shop-tls",
                  namespace: "platform",
                  condition: "True",
                  severity: "critical",
                  enforcement: "notify-only",
                },
                exp_annotations: notReady.annotations,
              },
            ],
          },
        ],
      },
      {
        interval: "1m",
        name: "a Ready certificate stays quiet",
        input_series: [{ series: ready, values: "1+0x40" }],
        alert_rule_test: [
          {
            eval_time: "20m",
            alertname: "CertificateNotReady",
            exp_alerts: [],
          },
        ],
      },
    ],
  );
});

test("the near-expiry rule fires for a certificate under fourteen days left, and stays quiet with thirty days left", async () => {
  const expiry = await ruleByTitle("CertificateNearExpiry");
  const notAfter =
    'certmanager_certificate_expiration_timestamp_seconds{name="shop-tls",namespace="platform"}';
  await runPromtool(
    [expiry],
    [
      {
        interval: "1m",
        name: "a certificate under fourteen days left fires after an hour",
        input_series: [{ series: notAfter, values: "1209599+0x130" }],
        alert_rule_test: [
          {
            eval_time: "30m",
            alertname: "CertificateNearExpiry",
            exp_alerts: [],
          },
          {
            eval_time: "70m",
            alertname: "CertificateNearExpiry",
            exp_alerts: [
              {
                exp_labels: {
                  name: "shop-tls",
                  namespace: "platform",
                  severity: "warning",
                  enforcement: "notify-only",
                },
                exp_annotations: expiry.annotations,
              },
            ],
          },
        ],
      },
      {
        interval: "1m",
        name: "a certificate with thirty days left stays quiet",
        input_series: [{ series: notAfter, values: "3801600+0x130" }],
        alert_rule_test: [
          {
            eval_time: "70m",
            alertname: "CertificateNearExpiry",
            exp_alerts: [],
          },
        ],
      },
    ],
  );
});
