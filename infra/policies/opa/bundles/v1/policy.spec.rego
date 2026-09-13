package envoy.authz

import rego.v1

test_allows_authenticated_developer if {
  allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-role":"developer"}}},"source":{"principal":"spiffe://cluster.local/ns/reference/sa/reference-frontend"},"destination":{"principal":"spiffe://cluster.local/ns/reference/sa/reference-api"}}}
}

test_denies_unknown_identity if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-role":"developer"}}},"source":{"principal":"spiffe://cluster.local/ns/reference/sa/unknown"},"destination":{"principal":"spiffe://cluster.local/ns/reference/sa/reference-api"}}}
}

