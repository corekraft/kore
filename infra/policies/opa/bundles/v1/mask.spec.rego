package system.log_test

import rego.v1

import data.system.log

sample := {"attributes":{"request":{"http":{
  "path":"/api/protected",
  "headers":{
    "authorization":"Bearer secret-token",
    "cookie":"session=abc",
    "x-api-key":"k",
    "x-kore-authenticated-role":"developer",
  },
}}}}

test_masks_authorization_header if {
  "/input/attributes/request/http/headers/authorization" in log.mask with input as sample
}

test_masks_cookie_and_api_key_headers if {
  masked := log.mask with input as sample
  "/input/attributes/request/http/headers/cookie" in masked
  "/input/attributes/request/http/headers/x-api-key" in masked
}

test_keeps_decision_context_visible if {
  masked := log.mask with input as sample
  not "/input/attributes/request/http/path" in masked
  not "/input/attributes/request/http/headers/x-kore-authenticated-role" in masked
}

test_masks_nothing_when_no_credentials_present if {
  count(log.mask) == 0 with input as {"attributes":{"request":{"http":{"path":"/x","headers":{}}}}}
}
