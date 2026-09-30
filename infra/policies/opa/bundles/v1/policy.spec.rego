package envoy.authz

import rego.v1

test_allows_developer_context_from_ambient_waypoint if {
  allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":"developer"}}}}}
}

test_denies_viewer_context_from_ambient_waypoint if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":"viewer"}}}}}
}
