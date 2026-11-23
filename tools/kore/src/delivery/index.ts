// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md
// The public surface of the app delivery domain: the deterministic eval of one candidate.
export { evaluateApp } from "./app-eval.js";
export type { EvalAttestations, EvalInput, EvalReport } from "./app-eval.js";
export { gitAppSource } from "./app-source.js";
export type { AppSource, GitAppSourceOptions } from "./app-source.js";
