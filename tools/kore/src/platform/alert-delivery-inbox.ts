// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md

// The inbox the owner reads the platform contact point's mail in, read through its API at run time.
// Both settings come from the environment only, never a file, and no value is ever returned in a message.
export const inboxUrlVariable = "KORE_ALERT_INBOX_API_URL";
export const inboxKeyVariable = "KORE_ALERT_INBOX_API_KEY";

export interface InboxSettings {
  url: string;
  key: string;
}

export type InboxSetup =
  { ok: true; settings: InboxSettings } | { ok: false; reason: string };

export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpGet = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Promise<HttpResponse>;

export interface InboxReader {
  /** True once a message whose subject names the alert arrived at or after the given time. */
  arrivedSince(since: number, alertName: string): Promise<boolean>;
}

/** Reads the two settings; both unset or only one set skips the check, and the reason names the variables only. */
export function inboxSetup(env: NodeJS.ProcessEnv): InboxSetup {
  const url = env[inboxUrlVariable];
  const key = env[inboxKeyVariable];
  if (url && key) {
    return { ok: true, settings: { url, key } };
  }
  if (!url && !key) {
    return {
      ok: false,
      reason:
        inboxUrlVariable +
        " and " +
        inboxKeyVariable +
        " are unset; set both at run time to confirm arrival, or leave both unset and the check is skipped",
    };
  }
  const missing = url ? inboxKeyVariable : inboxUrlVariable;
  return {
    ok: false,
    reason:
      missing +
      " is unset; set both " +
      inboxUrlVariable +
      " and " +
      inboxKeyVariable +
      " at run time, or leave both unset and the check is skipped",
  };
}

interface Message {
  subject: string;
  time: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(value: unknown): Message {
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  const subject =
    typeof record["subject"] === "string" ? record["subject"] : "";
  const stamp = [
    record["created_at"],
    record["createdAt"],
    record["timestamp"],
  ].find((candidate) => typeof candidate === "string");
  const time = typeof stamp === "string" ? Date.parse(stamp) : Number.NaN;
  return { subject, time };
}

function listInside(parsed: unknown): unknown {
  return isRecord(parsed) ? parsed["messages"] : undefined;
}

function messagesIn(body: string): Message[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("the inbox API answer is not JSON");
  }
  const list: unknown = Array.isArray(parsed) ? parsed : listInside(parsed);
  if (!Array.isArray(list)) {
    throw new Error("the inbox API answer holds no message list");
  }
  return list.map(messageOf);
}

async function fetchBody(
  settings: InboxSettings,
  http: HttpGet,
): Promise<string> {
  let response: HttpResponse;
  try {
    response = await http(settings.url, {
      Authorization: "Bearer " + settings.key,
    });
  } catch {
    throw new Error(
      "the inbox API did not answer; check " +
        inboxUrlVariable +
        " and the network",
    );
  }
  if (response.status < 200 || response.status > 299) {
    throw new Error(
      "the inbox API answered HTTP " +
        String(response.status) +
        "; check " +
        inboxKeyVariable,
    );
  }
  return response.body;
}

export function inboxReader(
  settings: InboxSettings,
  http: HttpGet,
): InboxReader {
  return {
    async arrivedSince(since, alertName) {
      const body = await fetchBody(settings, http);
      return messagesIn(body).some(
        (message) =>
          message.subject.includes(alertName) && message.time >= since,
      );
    },
  };
}
