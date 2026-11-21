import { describe, expect, it } from "vitest";
import { chromiumProgram } from "./chromium-program.js";

describe("chromiumProgram", () => {
  it("runs the flow inside the launched browser session with the host list it maps", () => {
    const program = chromiumProgram(
      ["backstage.kore.internal"],
      "return { assertions: [] };",
    );
    expect(program).toContain('const hosts = ["backstage.kore.internal"];');
    expect(program).toContain(
      "withChromium(hosts, async (chromium) => {\nreturn { assertions: [] };\n})",
    );
  });

  it("refuses an empty host list, so no name the flow visits is left unmapped to loopback", () => {
    expect(() => chromiumProgram([], "")).toThrow("at least one host");
  });

  it("launches Chromium ignoring certificate errors, as the local CA is not in the container's trust store", () => {
    expect(chromiumProgram(["a.kore.internal"], "")).toContain(
      "--ignore-certificate-errors",
    );
  });
});
