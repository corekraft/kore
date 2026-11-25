import { expect, test } from "vitest";
import {
  reasonOf,
  renderMissing,
  type MissingPrerequisite,
} from "./preflight-message.js";

test("a failure's reason is its first line, so a multi-line error stays one clause", () => {
  expect(reasonOf(new Error("i/o timeout\nmore detail"))).toBe("i/o timeout");
  expect(reasonOf("plain text")).toBe("plain text");
});

test("an API server address in a failure's reason is replaced, since a tailnet address never reaches a message", () => {
  expect(
    reasonOf(new Error("Get https://100.64.0.7:6443/readyz: i/o timeout")),
  ).toBe("Get the API server: i/o timeout");
});

test("a kubectl dial timeout names no IP address or port, since the tailnet API server address never reaches a message", () => {
  const reason = reasonOf(new Error("dial tcp 100.64.0.7:6443: i/o timeout"));
  expect(reason).toBe("dial tcp the address: i/o timeout");
  expect(reason).not.toMatch(/100\.64\.0\.7|6443/);
});

test("a host name with a port in a failure's reason is replaced too", () => {
  expect(
    reasonOf(new Error("dial tcp kube.example.com:6443: i/o timeout")),
  ).toBe("dial tcp the address: i/o timeout");
});

test("a bracketed IPv6 address with a port in a failure's reason is replaced too", () => {
  expect(
    reasonOf(new Error("dial tcp [fd7a:115c:a1e0::7]:6443: i/o timeout")),
  ).toBe("dial tcp the address: i/o timeout");
});

test("a reason with no address keeps its version numbers and words", () => {
  expect(
    reasonOf(new Error("kubectl 1.30.1 is older than the 1.31 this needs")),
  ).toBe("kubectl 1.30.1 is older than the 1.31 this needs");
});

const sops: MissingPrerequisite = {
  name: "sops recipient",
  problem: "no creation rule for infra/environments/vps/secrets in .sops.yaml",
  fix: "add the vps age recipient to a creation rule in .sops.yaml",
};
const lock: MissingPrerequisite = {
  name: "release chart lock",
  problem: "--platform-chart-lock is not given",
  fix: "pass the platform-charts.lock.json attached to the release",
};

test("the refusal names every missing prerequisite in one message, each with the fix for it", () => {
  const message = renderMissing("vps", [sops, lock]);
  expect(message).toContain(
    "- sops recipient: no creation rule for infra/environments/vps/secrets in .sops.yaml. Fix: add the vps age recipient to a creation rule in .sops.yaml",
  );
  expect(message).toContain(
    "- release chart lock: --platform-chart-lock is not given. Fix: pass the platform-charts.lock.json attached to the release",
  );
});

test("the refusal says how many prerequisites are missing and that nothing was changed", () => {
  expect(renderMissing("vps", [sops, lock])).toMatch(
    /^kore platform up --environment vps stopped before any change: 2 prerequisites are missing\./,
  );
  expect(renderMissing("vps", [sops])).toMatch(/: 1 prerequisite is missing\./);
});
