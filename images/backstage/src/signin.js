// Sign-in resolver: the identity comes from the Keycloak token alone, so no
// User entities are needed. Group paths from the groups claim (for example
// /platform/platform-operators) become group entity refs, which the
// authorization policy (policy.js) reads.
const NAME = /^[a-zA-Z0-9]([-_.a-zA-Z0-9]{0,61}[a-zA-Z0-9])?$/;

function groupRef(path) {
  return `group:default/${String(path).split("/").filter(Boolean).at(-1)}`;
}

export async function resolveSignIn(info, context) {
  const claims = info.result.fullProfile.userinfo ?? {};
  const username = claims.preferred_username;
  if (!username) {
    throw new Error(
      "the Keycloak token has no preferred_username claim; add the username mapper to the backstage client",
    );
  }
  if (!NAME.test(username)) {
    throw new Error(`the username "${username}" is not a valid entity name`);
  }
  const user = `user:default/${username}`;
  const groups = (claims.groups ?? []).map(groupRef);
  return context.issueToken({
    claims: { sub: user, ent: [user, ...groups] },
  });
}
