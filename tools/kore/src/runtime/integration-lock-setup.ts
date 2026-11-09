import { holdIntegrationLock } from "./integration-lock.js";

// Preloaded by `node --import` in every test:integration* script.
await holdIntegrationLock();
