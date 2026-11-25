package sigstore

import rego.v1

# The policy of one app record's ClusterImagePolicy (issue 1556, ADR 0166):
# admission binds an image to its record. Policy Controller v0.13.1 evaluates
# data.sigstore.isCompliant over its PolicyResult JSON, parsing the module as
# Rego v0 (cosign v2.5.0 rego.go), so this file keeps to syntax both parsers
# accept. The authority has already verified each signature against the platform
# workflow's keyless identities; this rule checks them again, so the rendered
# rules refuse any other identity on their own, and adds the binding: the
# signing workflow's repository, Fulcio OID 1.3.6.1.4.1.57264.1.5
# (githubWorkflowRepo, owner/name on github.com), must be the record's
# repository. The chart renders the record below these rules; with none
# rendered the default record matches nothing, so the policy fails closed.

default record := {"repository": "", "issuer": "", "subjects": []}

default isCompliant := false

isCompliant if {
	some signature in input.authorityMatches["platform-workflow"].signatures
	signature.issuer == record.issuer
	signature.subject in record.subjects
	signature.githubWorkflowRepo != ""
	concat("/", ["github.com", signature.githubWorkflowRepo]) == record.repository
}
