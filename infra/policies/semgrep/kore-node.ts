// Semgrep rule tests for kore-node.yaml: `mise run scan-sast-test`.
import * as cp from "node:child_process";
import { exec, execSync } from "node:child_process";
import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

declare const userInput: string;
declare const token: string;
declare const config: { password: string; name: string };

// ruleid: kore-child-process-shell
exec(`ls ${userInput}`);
// ruleid: kore-child-process-shell
execSync("kubectl get " + userInput);
// ruleid: kore-child-process-shell
cp.exec(userInput);
// ruleid: kore-child-process-shell
cp.spawn(userInput, [], { shell: true });
// ok: kore-child-process-shell
cp.execFile("kubectl", ["get", userInput]);
// ok: kore-child-process-shell
cp.spawn("kubectl", ["get", userInput]);

// ruleid: kore-path-traversal
await readFile(join("/srv", process.argv[2] ?? ""));
// ruleid: kore-path-traversal
fs.writeFileSync(process.env.TARGET ?? "", "x");
// ok: kore-path-traversal
await readFile(join("/srv", basename(process.argv[2] ?? "")));
// ok: kore-path-traversal
await readFile("/srv/fixed.json");

// ruleid: kore-secret-in-log
console.log("loaded", token);
// ruleid: kore-secret-in-log
console.error(config.password);
// ok: kore-secret-in-log
console.log("loaded", config.name);

// ruleid: kore-dynamic-regexp
new RegExp(userInput);
// ruleid: kore-dynamic-regexp
RegExp(userInput, "g");
// ok: kore-dynamic-regexp
new RegExp("^[a-z]+$");
// ruleid: kore-dynamic-regexp
new RegExp(`^${userInput}$`);

declare const req: { url: string };
// ruleid: kore-path-traversal
await readFile(join("/srv", req.url));
// ok: kore-path-traversal
await readFile(new URL("./fixture.json", import.meta.url));
