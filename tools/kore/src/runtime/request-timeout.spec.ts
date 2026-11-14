import { describe, expect, it, vi } from "vitest";
import { withRequestTimeout } from "./request-timeout.js";
import { kubectlVerb } from "./retry.js";
import { fakeRunner } from "./runtime-support.js";

vi.mock("./retry.js");

/** Runs one command through the wrapper, with `verb` as the kubectl verb it reads. */
async function sent(command: string, args: string[], verb?: string) {
  vi.mocked(kubectlVerb).mockReturnValue(verb);
  const { runner, run } = fakeRunner();
  await withRequestTimeout(runner, "20s").run(command, args);
  return run.mock.calls;
}

describe("withRequestTimeout", () => {
  it("gives a kubectl read a client-side request timeout", async () => {
    await expect(
      sent("kubectl", ["--context", "c", "get", "nodes"], "get"),
    ).resolves.toEqual([
      [
        "kubectl",
        ["--context", "c", "get", "nodes", "--request-timeout=20s"],
        undefined,
      ],
    ]);
  });

  it("leaves a read that sets its own request timeout alone", async () => {
    const args = ["get", "pods", "--request-timeout=5s"];

    await expect(sent("kubectl", args, "get")).resolves.toEqual([
      ["kubectl", args, undefined],
    ]);
  });

  it("never gives a watch a request timeout, however it is flagged", async () => {
    for (const flag of ["--watch", "--watch=true", "-w"]) {
      await expect(
        sent("kubectl", ["get", "pods", flag], "get"),
      ).resolves.toEqual([["kubectl", ["get", "pods", flag], undefined]]);
    }
  });

  it("never changes a write, or any other tool", async () => {
    for (const [command, args, verb] of [
      ["kubectl", ["--context", "c", "apply", "-f", "-"], "apply"],
      ["kubectl", ["wait", "--for=condition=Ready", "pod/x"], "wait"],
      ["helm", ["get", "values", "x"], undefined],
    ] as const) {
      await expect(sent(command, [...args], verb)).resolves.toEqual([
        [command, args, undefined],
      ]);
    }
  });

  it("passes the call's options through unchanged", async () => {
    vi.mocked(kubectlVerb).mockReturnValue("get");
    const { runner, run } = fakeRunner();

    await withRequestTimeout(runner, "20s").run("kubectl", ["get", "ns"], {
      capture: true,
    });

    expect(run).toHaveBeenCalledWith(
      "kubectl",
      ["get", "ns", "--request-timeout=20s"],
      { capture: true },
    );
  });

  it("gives every kubectl read verb a request timeout, not only get", async () => {
    for (const verb of [
      "describe",
      "top",
      "events",
      "api-resources",
      "auth",
      "logs",
    ]) {
      await expect(sent("kubectl", ["x", verb], verb)).resolves.toEqual([
        ["kubectl", ["x", verb, "--request-timeout=20s"], undefined],
      ]);
    }
  });

  it("never gives followed logs a request timeout", async () => {
    for (const flag of ["-f", "--follow", "--follow=true"]) {
      await expect(
        sent("kubectl", ["logs", "pod/x", flag], "logs"),
      ).resolves.toEqual([["kubectl", ["logs", "pod/x", flag], undefined]]);
    }
  });
});
