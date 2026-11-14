import type { Kind } from "./schema.js";

const HOST_KINDS: readonly Kind[] = ["host-sample"];

const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const isShare = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;

/** The host-sample payload fields: load, memory and swap may be absent; the count and the platform flag may not. */
export const HOST_RULES = [
  {
    field: "load",
    check: (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0,
    hint: "must be a finite number of 0 or more",
    kinds: HOST_KINDS,
    optional: true,
  },
  {
    field: "memory",
    check: isShare,
    hint: "must be a share from 0 to 1",
    kinds: HOST_KINDS,
    optional: true,
  },
  {
    field: "swap",
    check: isCount,
    hint: "must be a whole number of bytes, 0 or more",
    kinds: HOST_KINDS,
    optional: true,
  },
  {
    field: "sessions",
    check: isCount,
    hint: "must be a whole number, 0 or more",
    kinds: HOST_KINDS,
  },
  {
    field: "platform",
    check: (v: unknown) => typeof v === "boolean",
    hint: "must be true or false",
    kinds: HOST_KINDS,
  },
] as const;
