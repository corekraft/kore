package sigstore

import rego.v1

# The rules of application-images.rego, against the PolicyResult JSON Policy
# Controller v0.13.1 hands a ClusterImagePolicy's rego policy: one entry per
# authority under authorityMatches, each verified signature with its subject,
# issuer and githubWorkflowRepo (Fulcio OID 1.3.6.1.4.1.57264.1.5).

checkout := {
	"repository": "github.com/example-org/checkout",
	"issuer": "https://token.actions.githubusercontent.com",
	"subjects": ["https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.4.0"],
}

signed_by(subject, issuer, repo) := {"authorityMatches": {"platform-workflow": {"signatures": [{
	"id": "sig",
	"subject": subject,
	"issuer": issuer,
	"githubWorkflowRepo": repo,
}]}}}

platform_subject := "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.4.0"

github_issuer := "https://token.actions.githubusercontent.com"

test_admits_an_image_the_platform_workflow_signed_from_the_records_repository if {
	isCompliant with input as signed_by(platform_subject, github_issuer, "example-org/checkout")
		with record as checkout
}

test_refuses_an_image_signed_from_another_repository if {
	not isCompliant with input as signed_by(platform_subject, github_issuer, "example-org/payments")
		with record as checkout
}

test_refuses_a_repository_that_only_shares_the_records_prefix if {
	not isCompliant with input as signed_by(platform_subject, github_issuer, "example-org/checkout-fork")
		with record as checkout
}

test_refuses_a_signature_with_no_source_repository if {
	not isCompliant with input as signed_by(platform_subject, github_issuer, "")
		with record as checkout
}

test_refuses_an_image_signed_by_another_workflow_identity if {
	not isCompliant with input as signed_by(
		"https://github.com/example-org/checkout/.github/workflows/build.yaml@refs/heads/main",
		github_issuer,
		"example-org/checkout",
	)
		with record as checkout
}

test_refuses_an_image_signed_under_another_issuer if {
	not isCompliant with input as signed_by(platform_subject, "https://accounts.google.com", "example-org/checkout")
		with record as checkout
}

test_refuses_an_image_with_no_signature_from_the_platform_workflow_authority if {
	not isCompliant with input as {"authorityMatches": {"other-authority": {"signatures": [{
		"subject": platform_subject,
		"issuer": github_issuer,
		"githubWorkflowRepo": "example-org/checkout",
	}]}}}
		with record as checkout
}

test_admits_when_one_of_several_signatures_is_from_the_records_repository if {
	isCompliant with input as {"authorityMatches": {"platform-workflow": {"signatures": [
		{"subject": platform_subject, "issuer": github_issuer, "githubWorkflowRepo": "example-org/payments"},
		{"subject": platform_subject, "issuer": github_issuer, "githubWorkflowRepo": "example-org/checkout"},
	]}}}
		with record as checkout
}

test_refuses_everything_while_no_record_is_rendered if {
	not isCompliant with input as signed_by(platform_subject, github_issuer, "example-org/checkout")
}
