// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import { expect, test, vi } from "vitest";
import {
  inboxReader,
  inboxSetup,
  type HttpGet,
} from "./alert-delivery-inbox.js";

const url = "https://inbox.example.invalid/v0/messages";
const key = "key-example";
const since = Date.parse("2026-11-21T10:00:00Z");

async function messageOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
}

function listing(messages: unknown): string {
  return JSON.stringify(messages);
}

test("skips the inbox check, naming both variables and no value, when neither is set", () => {
  expect(inboxSetup({})).toEqual({
    ok: false,
    reason:
      "KORE_ALERT_INBOX_API_URL and KORE_ALERT_INBOX_API_KEY are unset; set both at run time to confirm arrival, or leave both unset and the check is skipped",
  });
});

test("skips the inbox check, naming the missing variable and no value, when only one is set", () => {
  const setup = inboxSetup({ KORE_ALERT_INBOX_API_URL: url });
  expect(setup).toEqual({
    ok: false,
    reason:
      "KORE_ALERT_INBOX_API_KEY is unset; set both KORE_ALERT_INBOX_API_URL and KORE_ALERT_INBOX_API_KEY at run time, or leave both unset and the check is skipped",
  });
  expect(JSON.stringify(setup)).not.toContain(url);
});

test("reads the inbox URL and key from the run-time environment when both are set", () => {
  expect(
    inboxSetup({
      KORE_ALERT_INBOX_API_URL: url,
      KORE_ALERT_INBOX_API_KEY: key,
    }),
  ).toEqual({ ok: true, settings: { url, key } });
});

test("reports arrival when the inbox holds an alert message sent after the alert fired", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 200,
    body: listing([
      {
        subject: "[FIRING:1] ServiceUnavailable golden-path-example",
        created_at: "2026-11-21T10:05:00Z",
      },
    ]),
  }));
  expect(
    await inboxReader({ url, key }, http).arrivedSince(
      since,
      "ServiceUnavailable",
    ),
  ).toBe(true);
  expect(http).toHaveBeenCalledWith(url, {
    Authorization: "Bearer key-example",
  });
});

test("does not count a message sent before the alert fired", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 200,
    body: listing([
      {
        subject: "[FIRING:1] ServiceUnavailable golden-path-example",
        created_at: "2026-11-21T09:59:00Z",
      },
    ]),
  }));
  expect(
    await inboxReader({ url, key }, http).arrivedSince(
      since,
      "ServiceUnavailable",
    ),
  ).toBe(false);
});

test("does not count a message about another alert", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 200,
    body: listing([
      {
        subject: "[FIRING:1] ServiceHighErrorRatio golden-path-example",
        created_at: "2026-11-21T10:05:00Z",
      },
    ]),
  }));
  expect(
    await inboxReader({ url, key }, http).arrivedSince(
      since,
      "ServiceUnavailable",
    ),
  ).toBe(false);
});

test("reads a message list wrapped in an object as well as a bare list", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 200,
    body: listing({
      messages: [
        {
          subject: "[FIRING:1] ServiceUnavailable golden-path-example",
          createdAt: "2026-11-21T10:05:00Z",
        },
      ],
    }),
  }));
  expect(
    await inboxReader({ url, key }, http).arrivedSince(
      since,
      "ServiceUnavailable",
    ),
  ).toBe(true);
});

test("names a network failure without the inbox URL or key", async () => {
  const http = vi.fn<HttpGet>(async () => {
    throw new Error("getaddrinfo ENOTFOUND inbox.example.invalid");
  });
  expect(
    await messageOf(inboxReader({ url, key }, http).arrivedSince(since, "x")),
  ).toBe(
    "the inbox API did not answer; check KORE_ALERT_INBOX_API_URL and the network",
  );
});

test("names an HTTP refusal by its status and never echoes the key", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 401,
    body: "rejected key-example",
  }));
  expect(
    await messageOf(inboxReader({ url, key }, http).arrivedSince(since, "x")),
  ).toBe("the inbox API answered HTTP 401; check KORE_ALERT_INBOX_API_KEY");
});

test("refuses an answer that is not JSON, without echoing it", async () => {
  const http = vi.fn<HttpGet>(async () => ({
    status: 200,
    body: "<html>key-example</html>",
  }));
  expect(
    await messageOf(inboxReader({ url, key }, http).arrivedSince(since, "x")),
  ).toBe("the inbox API answer is not JSON");
});

test("refuses an answer that holds no message list", async () => {
  const http = vi.fn<HttpGet>(async () => ({ status: 200, body: "{}" }));
  expect(
    await messageOf(inboxReader({ url, key }, http).arrivedSince(since, "x")),
  ).toBe("the inbox API answer holds no message list");
});
