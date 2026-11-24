import { HOST_RULES } from "./schema-host.js";
import { ROLLOUT_RULES, type RolloutOrigin } from "./schema-rollout.js";

export type { RolloutOrigin };

/** The payload fields of the kinds that carry their own: host-sample's and platform.rolled-out's. */
export const PAYLOAD_RULES = [...HOST_RULES, ...ROLLOUT_RULES];
