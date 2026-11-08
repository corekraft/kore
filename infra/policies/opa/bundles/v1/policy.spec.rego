package envoy.authz

import rego.v1

test_allows_developer_context_from_ambient_waypoint if {
  allow with input as {"attributes":{"request":{"http":{"path":"/api/protected","headers":{"x-kore-authenticated-role":"developer"}}}}}
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
