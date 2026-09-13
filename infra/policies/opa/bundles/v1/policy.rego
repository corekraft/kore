package envoy.authz

import rego.v1

default allow := false

allow if {
  input.attributes.request.http.path == "/api/protected"
  startswith(input.attributes.source.principal, "spiffe://cluster.local/ns/reference/sa/reference-frontend")
  input.attributes.destination.principal == "spiffe://cluster.local/ns/reference/sa/reference-api"
  input.attributes.request.http.headers["x-kore-role"] == "developer"
}

