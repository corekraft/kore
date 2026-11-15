// Group-based authorization: only members of the platform-operators group may
// use Backstage. Everything else, including a request with no identity, is denied.
export const OPERATORS_GROUP = "group:default/platform-operators";

export function decide(ownershipEntityRefs) {
  return ownershipEntityRefs?.includes(OPERATORS_GROUP) ? "ALLOW" : "DENY";
}
