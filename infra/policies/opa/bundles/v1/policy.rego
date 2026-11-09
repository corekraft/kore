package envoy.authz

import rego.v1

default allow := false

# The waypoint's ext_authz CheckRequest carries no TLS peer identity (mTLS ends on the
# HBONE listener), but Istio 1.31 can synthesize x-forwarded-client-cert from ztunnel's
# authenticated peer identity before the CUSTOM check runs. The waypoint Gateway opts in
# with ambient.istio.io/xfcc-include-client-identity and overwrites any caller-supplied
# value, so the URI element is the authenticated source workload principal (ADR 0066).
_xfcc := input.attributes.request.http.headers["x-forwarded-client-cert"]

source_principal := principal if {
  is_string(_xfcc)
  matches := regex.find_all_string_submatch_n(`(?:^|;)URI=([^;,]+)`, _xfcc, 1)
  principal := matches[0][1]
  regex.match(`^spiffe://cluster\.local/ns/[^/]+/sa/[^/]+$`, principal)
}

# The native Service-targeted Istio ALLOW policy still pins the calling workload; this
# rule makes the authenticated principal part of OPA's own decision input.
allow if {
  input.attributes.request.http.path == "/api/protected"
  input.attributes.request.http.headers["x-kore-authenticated-role"] == "developer"
  source_principal
}
