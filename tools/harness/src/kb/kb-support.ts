// Literal fakes shared by the kb unit specs: fixed values only, no logic. A support file is not a unit, so it needs no spec of its own (ADR 0098).
import type { Finding } from "./markdown.js";

/** The sentinel a mocked finding() returns; assertions read its call arguments instead. */
export const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };
export const FIX_LINK = "point the link at an existing file or remove it";
export const FIX_INDEX = "create it with one entry per plan, ADR, and skill";
