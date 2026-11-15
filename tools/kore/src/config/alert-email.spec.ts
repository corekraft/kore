// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test } from "vitest";
import {
  alertContactPoint,
  alertEmailErrors,
  alertEmailHelmArgs,
  alertEmailWarnings,
} from "./alert-email.js";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import type { Environment } from "./types.js";

const smtp = {
  host: "smtp.example.invalid",
  port: 587,
  from: "kore@example.invalid",
};
const portal = { "platform-portal": true };
const configured: Partial<Environment> = {
  features: portal,
  alertEmail: {
    addresses: ["ops@example.invalid", "oncall@example.invalid"],
    smtp,
  },
};
/** The operator's shell: the address and SMTP settings, from outside git. */
const operatorEnv: NodeJS.ProcessEnv = {
  KORE_ALERT_EMAIL_ADDRESSES: "ops@example.invalid; oncall@example.invalid",
  KORE_ALERT_SMTP_HOST: "smtp.example.invalid",
  KORE_ALERT_SMTP_PORT: "587",
  KORE_ALERT_SMTP_FROM: "kore@example.invalid",
};
const portalOnly = fakeEnvironment({ features: portal });

test("an environment with no alertEmail and no operator variables has no errors, so every shipped overlay validates with the address unset", () => {
  expect(alertEmailErrors(fakeEnvironment(), {})).toEqual([]);
});

test("a complete overlay alertEmail has no errors", () => {
  expect(alertEmailErrors(fakeEnvironment(configured), {})).toEqual([]);
});

test("the operator's environment variables supply the address and SMTP settings with nothing in the overlay", () => {
  expect(alertEmailErrors(portalOnly, operatorEnv)).toEqual([]);
  expect(alertContactPoint(portalOnly, operatorEnv)).toBe(
    "kore-platform-email",
  );
});

test("an address without an SMTP host, port and from is refused before any cluster call, naming where to set each", () => {
  const env = { KORE_ALERT_EMAIL_ADDRESSES: "ops@example.invalid" };
  expect(alertEmailErrors(portalOnly, env)).toEqual([
    "alert SMTP host is required when an alert address is set; set KORE_ALERT_SMTP_HOST or environment.alertEmail.smtp.host",
    "alert SMTP port is required when an alert address is set; set KORE_ALERT_SMTP_PORT or environment.alertEmail.smtp.port",
    "alert SMTP from is required when an alert address is set; set KORE_ALERT_SMTP_FROM or environment.alertEmail.smtp.from",
  ]);
});

test("a malformed address, port or from is refused without echoing the address", () => {
  const errors = alertEmailErrors(portalOnly, {
    KORE_ALERT_EMAIL_ADDRESSES:
      "not-an-address;a b@example.invalid;ok@example.invalid",
    KORE_ALERT_SMTP_HOST: "smtp.example.invalid",
    KORE_ALERT_SMTP_PORT: "70000",
    KORE_ALERT_SMTP_FROM: "nope",
  });
  expect(errors).toEqual([
    "2 alert address(es) are not email addresses; fix KORE_ALERT_EMAIL_ADDRESSES or environment.alertEmail.addresses",
    "alert SMTP port must be an integer from 1 to 65535; set KORE_ALERT_SMTP_PORT or environment.alertEmail.smtp.port",
    "alert SMTP from must be an email address; set KORE_ALERT_SMTP_FROM or environment.alertEmail.smtp.from",
  ]);
  expect(JSON.stringify(errors)).not.toContain("not-an-address");
});

test("an empty overlay address list and a non-object alertEmail are refused", () => {
  expect(
    alertEmailErrors(fakeEnvironment({ alertEmail: { addresses: [] } }), {}),
  ).toEqual([
    "the alert address list must hold at least one address; set KORE_ALERT_EMAIL_ADDRESSES or environment.alertEmail.addresses, or leave both unset",
  ]);
  expect(
    alertEmailErrors(
      fakeEnvironment({ alertEmail: malformed("ops@example.invalid") }),
      {},
    ),
  ).toEqual(["environment.alertEmail must be an object"]);
});

test("a credential in the environment config is refused, because credentials stream on stdin only", () => {
  expect(
    alertEmailErrors(
      fakeEnvironment({
        alertEmail: {
          ...configured.alertEmail!,
          smtp: { ...smtp, ...malformed<object>({ password: "hunter2" }) },
        },
      }),
      {},
    ),
  ).toEqual([
    "environment.alertEmail.smtp.password is not allowed: stream SMTP credentials with kore secrets smtp (ADR 0034), never in config or git",
  ]);
});

test("with the flag on and no address, validate warns where to set it", () => {
  expect(
    alertEmailWarnings(fakeRepository({ environment: portalOnly }), {}),
  ).toEqual([
    "alerts have no contact point: set KORE_ALERT_EMAIL_ADDRESSES (and KORE_ALERT_SMTP_HOST, KORE_ALERT_SMTP_PORT, KORE_ALERT_SMTP_FROM) in the shell that runs kore, then stream the SMTP login with kore secrets smtp; the address is never committed (the repository is public); until then the default alerts show only in Grafana",
  ]);
});

test("with the flag off, or with an address set in the overlay or the operator's shell, there is no warning", () => {
  const warn = (environment: Environment, env: NodeJS.ProcessEnv) =>
    alertEmailWarnings(fakeRepository({ environment }), env);
  expect(warn(fakeEnvironment(), {})).toEqual([]);
  expect(warn(fakeEnvironment(configured), {})).toEqual([]);
  expect(warn(portalOnly, operatorEnv)).toEqual([]);
});

test("no address configured renders no contact point: no Helm argument reaches Grafana or the rules", () => {
  expect(alertEmailHelmArgs(portalOnly, "grafana", {})).toEqual([]);
  expect(
    alertEmailHelmArgs(portalOnly, "kore-service-observability", {}),
  ).toEqual([]);
  expect(alertContactPoint(portalOnly, {})).toBeUndefined();
});

test("a configured address with the flag off renders nothing, even from the operator's shell", () => {
  const environment = fakeEnvironment({ ...configured, features: {} });
  expect(alertEmailHelmArgs(environment, "grafana", operatorEnv)).toEqual([]);
  expect(alertContactPoint(environment, operatorEnv)).toBeUndefined();
});

const grafanaArgs = [
  "--set-json",
  `alerting=${JSON.stringify({
    "contactpoints.yaml": {
      apiVersion: 1,
      contactPoints: [
        {
          orgId: 1,
          name: "kore-platform-email",
          receivers: [
            {
              uid: "kore-platform-email",
              type: "email",
              settings: {
                addresses: "ops@example.invalid;oncall@example.invalid",
                singleEmail: true,
              },
            },
          ],
        },
      ],
    },
    "policies.yaml": {
      apiVersion: 1,
      policies: [
        {
          orgId: 1,
          receiver: "kore-platform-email",
          group_by: ["service", "alertname"],
        },
      ],
    },
  })}`,
  "--set-json",
  `grafana\\.ini.smtp=${JSON.stringify({
    enabled: true,
    host: "smtp.example.invalid:587",
    from_address: "kore@example.invalid",
  })}`,
  "--set-json",
  `envValueFrom=${JSON.stringify({
    GF_SMTP_USER: {
      secretKeyRef: { name: "grafana-smtp", key: "user", optional: true },
    },
    GF_SMTP_PASSWORD: {
      secretKeyRef: { name: "grafana-smtp", key: "password", optional: true },
    },
  })}`,
];

test("Grafana gets one email contact point, a policy routing to it, the SMTP settings, and the login by Secret reference", () => {
  expect(
    alertEmailHelmArgs(fakeEnvironment(configured), "grafana", {}),
  ).toEqual(grafanaArgs);
});

test("the operator's shell yields the same Grafana arguments as the overlay would", () => {
  expect(alertEmailHelmArgs(portalOnly, "grafana", operatorEnv)).toEqual(
    grafanaArgs,
  );
});

test("the operator's environment overrides the overlay", () => {
  const args = alertEmailHelmArgs(fakeEnvironment(configured), "grafana", {
    KORE_ALERT_EMAIL_ADDRESSES: "other@example.invalid",
  });
  expect(args[1]).toContain('"addresses":"other@example.invalid"');
  expect(args[1]).not.toContain("ops@example.invalid");
});

test("the service rules carry the contact point name as their destination label, and only when an address is set", () => {
  expect(
    alertEmailHelmArgs(
      fakeEnvironment(configured),
      "kore-service-observability",
      {},
    ),
  ).toEqual(["--set-string", "alerts.destination=kore-platform-email"]);
  expect(alertContactPoint(fakeEnvironment(configured), {})).toBe(
    "kore-platform-email",
  );
});

test("no other component receives alert arguments", () => {
  expect(
    alertEmailHelmArgs(fakeEnvironment(configured), "prometheus", {}),
  ).toEqual([]);
});
