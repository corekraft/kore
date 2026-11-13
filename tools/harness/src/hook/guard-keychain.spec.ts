import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../testing/guardrail-support.js";
import { bash, guard } from "./guard-modes-support.js";

// A hint, not a boundary (ADR 0096): the sandbox that denies the keychain is the boundary.
describe("the secret guard and the kore keychain items", () => {
  it.each([
    "security find-generic-password -s kore.judge.pat -a kore -w",
    "security find-generic-password -a kore -w -s kore.writer.private-key",
    "/usr/bin/security find-generic-password -ws kore.writer.app-id",
    "FOO=1 security find-generic-password -s kore.judge.pat -w",
    "security dump-keychain -d",
    "security export -k login.keychain-db -t certs",
    "echo hi && security find-generic-password -s kore.judge.pat -w",
  ])("blocks %s with a secret-path hint", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result.code).toBe(2);
    expect(result.err).toContain("secret-path");
    expect(result.err).toContain("keychain");
  });

  it.each([
    "security find-generic-password -s some.other.service -w",
    "security find-identity -v",
    "security list-keychains",
    "echo security find-generic-password",
  ])("lets %s through", async (command) => {
    expect((await guard(bash(command), committedInventoryText)).code).toBe(0);
  });
});
