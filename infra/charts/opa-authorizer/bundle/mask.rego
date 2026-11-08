package system.log

import rego.v1

# OPA applies this masking policy to every decision log entry before export, so
# credentials in the ext-authz request never reach logs or the Collector.
_secret_headers := {"authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"}

mask contains path if {
  some header in _secret_headers
  input.attributes.request.http.headers[header]
  path := sprintf("/input/attributes/request/http/headers/%s", [header])
}

mask contains "/input/attributes/request/http/body" if input.attributes.request.http.body

mask contains "/input/attributes/request/http/raw_body" if input.attributes.request.http.raw_body
