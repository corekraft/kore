package envoy.authz

import rego.v1

default allow := false

# Istio 1.30 ambient waypoint CheckRequests omit workload principals. The native
# Service-targeted Istio ALLOW policy enforces frontend identity before this role check.
allow if {
  input.attributes.request.http.path == "/api/protected"
  input.attributes.request.http.headers["x-kore-authenticated-role"] == "developer"
}
