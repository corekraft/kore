// The in-container driver: a Node program that launches the image's headless
// Chromium and drives it over the DevTools protocol with Node's built-in WebSocket.
// No npm package is installed at run time, so the image's digest is the whole pin.

/** The helper prelude every browser program starts with. Plain JavaScript, emitted verbatim. */
const prelude =
  "const { spawn } = require('node:child_process');\nconst { existsSync, mkdtempSync, readdirSync, readFileSync } = require('node:fs');\nconst { tmpdir } = require('node:os');\nconst { join } = require('node:path');\nconst LF = String.fromCharCode(10);\nconst sleep = (ms) => new Promise((done) => setTimeout(done, ms));\nfunction headlessShell() {\n  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright';\n  const dir = readdirSync(root).find((name) => name.startsWith('chromium_headless_shell-'));\n  if (dir === undefined) {\n    throw new Error('the image carries no headless Chromium under ' + root);\n  }\n  return join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');\n}\nasync function devToolsEndpoint(profile) {\n  const file = join(profile, 'DevToolsActivePort');\n  for (let attempt = 0; attempt < 300; attempt++) {\n    if (existsSync(file)) {\n      const [port, path] = readFileSync(file, 'utf8').split(LF);\n      if (port && path) {\n        return 'ws://127.0.0.1:' + port + path.trim();\n      }\n    }\n    await sleep(100);\n  }\n  throw new Error('Chromium opened no DevTools port within 30 s');\n}\nasync function withChromium(hosts, run) {\n  const profile = mkdtempSync(join(tmpdir(), 'browser-'));\n  const rules = hosts.map((host) => 'MAP ' + host + ' 127.0.0.1').join(', ');\n  const chrome = spawn(headlessShell(), [\n    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',\n    '--ignore-certificate-errors', '--host-resolver-rules=' + rules,\n    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',\n  ], { stdio: 'ignore' });\n  const socket = new WebSocket(await devToolsEndpoint(profile));\n  let socketFailed = null;\n  socket.addEventListener('error', () => { socketFailed = new Error('the DevTools socket failed'); });\n  await new Promise((open, fail) => {\n    socket.addEventListener('open', open);\n    socket.addEventListener('error', () => fail(new Error('could not open the DevTools socket')));\n  });\n  const pending = new Map();\n  const pages = new Map();\n  let nextId = 1;\n  socket.addEventListener('message', (event) => {\n    const message = JSON.parse(String(event.data));\n    if (message.id !== undefined) {\n      const waiter = pending.get(message.id);\n      pending.delete(message.id);\n      if (message.error) { waiter.reject(new Error(message.error.message)); } else { waiter.resolve(message.result || {}); }\n      return;\n    }\n    const page = pages.get(message.sessionId);\n    if (page === undefined || message.params === undefined) {\n      return;\n    }\n    if (message.method === 'Network.responseReceived' && message.params.type === 'Document') {\n      page.documents.push(message.params.response);\n    }\n    if (message.method === 'Network.requestWillBeSent' && message.params.redirectResponse && message.params.type === 'Document') {\n      page.documents.push(message.params.redirectResponse);\n    }\n  });\n  const send = (method, params, sessionId) => new Promise((resolve, reject) => {\n    const id = nextId++;\n    pending.set(id, { resolve, reject });\n    socket.send(JSON.stringify({ id, method, params: params || {}, sessionId }));\n  });\n  async function newPage() {\n    const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });\n    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });\n    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });\n    const page = { sessionId, documents: [] };\n    pages.set(sessionId, page);\n    await send('Page.enable', {}, sessionId);\n    await send('Network.enable', {}, sessionId);\n    return page;\n  }\n  async function evaluate(page, expression) {\n    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page.sessionId);\n    if (reply.exceptionDetails) {\n      throw new Error('a page script failed');\n    }\n    return reply.result.value;\n  }\n  const api = {\n    newPage,\n    evaluate,\n    go: (page, url) => send('Page.navigate', { url }, page.sessionId),\n    async waitFor(page, expression, what) {\n      const deadline = Date.now() + 90000;\n      while (Date.now() < deadline) {\n        try {\n          if ((await evaluate(page, expression)) === true) {\n            return;\n          }\n        } catch (error) {\n          // The page is still loading; keep polling until the deadline.\n        }\n        await sleep(250);\n      }\n      let where = 'a page that could not be read'; try { where = String(await evaluate(page, 'location.host + location.pathname')); } catch (error) { /* the page may be mid-navigation */ } throw new Error('timed out after 90 s waiting for ' + what + ' (the browser was on ' + where + ')');\n    },\n    async type(page, selector, text) {\n      await evaluate(page, '(document.querySelector(' + JSON.stringify(selector) + ').focus(), true)');\n      await send('Input.insertText', { text }, page.sessionId);\n    },\n  };\n  try {\n    const result = await run(api);\n    if (socketFailed) {\n      throw socketFailed;\n    }\n    console.log(JSON.stringify(result));\n  } finally {\n    socket.close();\n    chrome.kill('SIGKILL');\n  }\n}";

/** The api method a program opts into: the page's stored cookies, attributes only, never a value. */
const cookiesMethod = [
  "    async cookies(page) {",
  "      const reply = await send('Network.getCookies', {}, page.sessionId);",
  "      return reply.cookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite === undefined ? null : cookie.sameSite }));",
  "    },",
  "",
].join(String.fromCharCode(10));

/** The line that closes the api object, where an opted-in method is added before it. */
const apiEnd = "  };\n  try {\n    const result = await run(api);";

export interface ChromiumProgramOptions {
  /** Adds `cookies(page)` to the `chromium` api. Without it the program is unchanged. */
  cookies?: boolean;
}

/**
 * A Node program that runs `flow` against a headless Chromium. The hosts are
 * mapped to loopback, so the flow reaches the platform gateway by name. The flow
 * receives `chromium` (newPage, go, evaluate, waitFor, type, and cookies when
 * asked for) and returns the result, which the program prints as its last stdout
 * line.
 */
export function chromiumProgram(
  hosts: readonly string[],
  flow: string,
  options: ChromiumProgramOptions = {},
): string {
  if (hosts.length === 0) {
    throw new Error(
      "the browser program needs at least one host to map to loopback",
    );
  }
  const driver =
    options.cookies === true
      ? prelude.replace(apiEnd, () => cookiesMethod + apiEnd)
      : prelude;
  return [
    driver,
    "const hosts = " + JSON.stringify(hosts) + ";",
    "withChromium(hosts, async (chromium) => {",
    flow,
    "}).catch((error) => { console.error(error.message); process.exit(1); });",
  ].join(String.fromCharCode(10));
}
