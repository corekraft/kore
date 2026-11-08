// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
export {
  bootstrapControllers,
  platformDestroy,
  platformRender,
  platformStatus,
  platformStop,
  platformUp,
} from "./platform.js";
export type { ComponentStatus } from "./platform.js";
