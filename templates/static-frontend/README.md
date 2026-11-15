# Static frontend template

Golden-path template for a static frontend
([ADR 0045](../../docs/decisions/0045-static-frontends-as-signed-images.md)).
Put the frontend build in `src/`; the `Dockerfile` copies it into a pinned
static-server image. The Gateway serves it at `/`, and the service's BFF at
`/api` on the same host.

The release workflow builds, signs and publishes the image as
`ghcr.io/corekraft/kore/templates/static-frontend`. Nothing deploys it yet.
