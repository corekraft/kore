import { randomUUID } from "node:crypto";

/** Source of unique event ids, injectable so tests are deterministic. */
export interface IdSource {
  next(): string;
}

export const systemIds: IdSource = {
  next: () => randomUUID(),
};
