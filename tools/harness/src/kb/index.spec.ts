// The kb barrel: exactly the entry points the rest of the harness uses, each the module's own function.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { expect, test, vi } from "vitest";
import * as kb from "./index.js";
import { findings } from "./findings.js";
import { slug } from "./markdown.js";
import { format, run } from "./report.js";
import { staleDocuments } from "./stale.js";

vi.mock("./findings.js", () => ({ findings: vi.fn() }));
vi.mock("./markdown.js", () => ({ slug: vi.fn() }));
vi.mock("./report.js", () => ({ format: vi.fn(), run: vi.fn() }));
vi.mock("./stale.js", () => ({ staleDocuments: vi.fn() }));

test("the kb barrel exposes exactly its five entry points", () => {
  expect(Object.keys(kb).sort()).toEqual([
    "findings",
    "format",
    "run",
    "slug",
    "staleDocuments",
  ]);
});

test("each entry point is the function of the module that owns it", () => {
  expect(kb.findings).toBe(findings);
  expect(kb.slug).toBe(slug);
  expect(kb.format).toBe(format);
  expect(kb.run).toBe(run);
  expect(kb.staleDocuments).toBe(staleDocuments);
});
