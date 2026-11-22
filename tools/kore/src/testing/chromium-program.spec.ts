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

  it("names only the host and path of the page when a wait times out, never its query, text or values", () => {
    const program = chromiumProgram(["a.kore.internal"], "");
    expect(program).toContain("location.host + location.pathname");
    expect(program).not.toContain("location.href");
    expect(program).not.toContain("innerText");
    expect(program).not.toContain("document.body");
  });

  it("leaves the cookie method out of the browser api by default, so the Backstage program stays as it was", () => {
    const program = chromiumProgram(["a.kore.internal"], "return 1;");
    expect(program).not.toContain("getCookies");
    expect(program).not.toContain("async cookies(");
  });

  it("adds only a cookies(page) method to the browser api when asked, reading the page's stored cookies", () => {
    const plain = chromiumProgram(["a.kore.internal"], "return 1;");
    const withCookies = chromiumProgram(["a.kore.internal"], "return 1;", {
      cookies: true,
    });
    const method = [
      "    async cookies(page) {",
      "      const reply = await send('Network.getCookies', {}, page.sessionId);",
      "      return reply.cookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite === undefined ? null : cookie.sameSite }));",
      "    },",
      "",
    ].join("\n");
    expect(withCookies).toContain(method);
    expect(withCookies.replace(method, "")).toBe(plain);
  });

  it("never lets the cookies method return a cookie's value", () => {
    const program = chromiumProgram(["a.kore.internal"], "", { cookies: true });
    expect(program).not.toContain("cookie.value");
  });

  it("emits the default program when the cookies option is false", () => {
    expect(chromiumProgram(["a.kore.internal"], "x", { cookies: false })).toBe(
      chromiumProgram(["a.kore.internal"], "x"),
    );
  });

  it("launches Chromium ignoring certificate errors, as the local CA is not in the container's trust store", () => {
    expect(chromiumProgram(["a.kore.internal"], "")).toContain(
      "--ignore-certificate-errors",
    );
  });
});
