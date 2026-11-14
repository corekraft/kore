import { holdLiveLock } from "./live-lock.js";

// Preloaded by `node --import` in every test:live* script.
await holdLiveLock();
