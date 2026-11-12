// A status report may name resource kinds and fields such as
// AuthorizationPolicy or passwordSecretRef; only a credential-shaped key with a
// string value, a bearer token, or key material counts as an exposed credential.
const credentialKey =
  /"(?:password|passwd|token|api[_-]?token|authorization|bearer)"\s*:\s*"/i;
const bearerToken = /\bbearer\s+[A-Za-z0-9._~+/-]+=*/i;
const privateKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function exposesCredential(text: string): boolean {
  return (
    credentialKey.test(text) || bearerToken.test(text) || privateKey.test(text)
  );
}
