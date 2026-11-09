package envoy.authz

import rego.v1

test_allows_developer_context_from_ambient_waypoint if {
  allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":"developer","x-forwarded-client-cert":"URI=spiffe://cluster.local/ns/app/sa/reference-frontend"}}}}}
}

test_denies_viewer_context_from_ambient_waypoint if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":"viewer"}}}}}
}

test_denies_empty_input if {
  not allow with input as {}
}

test_denies_missing_headers if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected"}}}}
}

test_denies_missing_path if {
  not allow with input as {"attributes":{"request":{"http":{"headers":{"x-kore-authenticated-role":"developer"}}}}}
}

test_denies_malformed_attributes if {
  not allow with input as {"attributes":"developer"}
}

test_denies_role_of_wrong_type if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":["developer"]}}}}}
}

test_denies_caller_supplied_role_header if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-role":"developer"}}}}}
}

test_denies_other_paths_for_developer if {
  not allow with input as {"attributes":{"request":{"http":{"path":"/api/other","headers":{"x-kore-authenticated-role":"developer"}}}}}
}

# The ambient waypoint synthesizes x-forwarded-client-cert from ztunnel's authenticated
# peer identity (ambient.istio.io/xfcc-include-client-identity); ADR 0066.
_sample_xfcc := "By=spiffe://cluster.local/ns/app/sa/reference-api-waypoint;URI=spiffe://cluster.local/ns/app/sa/reference-frontend"

_request(headers) := {"attributes": {"request": {"http": {"path": "/api/protected", "headers": headers}}}}

test_allows_developer_with_authenticated_workload_principal if {
  allow with input as _request({"x-kore-authenticated-role": "developer", "x-forwarded-client-cert": _sample_xfcc})
}

test_denies_developer_without_workload_principal if {
  not allow with input as _request({"x-kore-authenticated-role": "developer"})
}

test_denies_developer_with_malformed_workload_principal if {
  not allow with input as _request({"x-kore-authenticated-role": "developer", "x-forwarded-client-cert": "By=x;URI=not-a-spiffe-id"})
}

test_denies_developer_from_foreign_trust_domain if {
  not allow with input as _request({"x-kore-authenticated-role": "developer", "x-forwarded-client-cert": "URI=spiffe://evil.example/ns/app/sa/reference-frontend"})
}

test_exposes_source_principal if {
  source_principal == "spiffe://cluster.local/ns/app/sa/reference-frontend" with input as _request({"x-forwarded-client-cert": _sample_xfcc})
}
