// The session cookie policy every golden-path template must declare: host-only,
// HttpOnly, Secure and SameSite (vision, host-only cookies; plan 15 Step 4).

// The session cookie sits at server > servlet > session > cookie in the
// template's application.yaml: its keys are at 8 spaces, its header at 6.
function sessionCookieKeys(properties: string): Map<string, string> {
  const keys = new Map<string, string>();
  const lines = properties.split("\n");
  const start = lines.indexOf("      cookie:");
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^ {8}\S/.test(line)) {
      break;
    }
    const pair = /^ {8}([\w-]+): (\S+)$/.exec(line);
    if (pair?.[1] !== undefined && pair[2] !== undefined) {
      keys.set(pair[1], pair[2]);
    }
  }
  return keys;
}

// Returns one message per way the template's session cookie breaks the policy;
// an empty list means it complies. Pure: it reads only its argument.
export function sessionCookieViolations(properties: string): string[] {
  const cookie = sessionCookieKeys(properties);
  const violations: string[] = [];
  if (cookie.get("http-only") !== "true") {
    violations.push("HttpOnly is not set to true");
  }
  if (cookie.get("secure") !== "true") {
    violations.push("Secure is not set to true");
  }
  const sameSite = cookie.get("same-site")?.toLowerCase();
  if (sameSite !== "lax" && sameSite !== "strict") {
    violations.push("SameSite is not lax or strict");
  }
  if (/^\s*domain:/m.test(properties) || /Domain=/i.test(properties)) {
    violations.push("a Domain is set; the cookie must be host-only");
  }
  return violations;
}
