#!/usr/bin/env bash
# Packages the configuration-phase releases that Argo CD takes over (ADR 0043)
# as Helm charts, offline and reproducibly, so the release job can push them to
# the platform OCI registry. The image policy is not in this list: it stays
# with kore so the tool that deploys cannot change which signatures are trusted.
#
# A chart release is packaged as it is. A plain manifest directory is wrapped in
# a generated chart that embeds the files raw (.Files.Get), because Helm must not
# template them: a Crossplane composition carries Go template text of its own.
#
# The version is content-addressed, 0.0.0-<12 hex of the sha256 of the staged
# tree>, so a content change is a new version and the same content is the same
# version, never a republish of different bytes (ADR 0043, immutable charts).
#
# Usage: package-platform-charts.sh <outdir>
# Prints one JSON line per chart, in order: {"name","version","file"}.
# Paths come from infra/catalog/components.yaml, the owner of every source.
set -euo pipefail

[ "$#" -eq 1 ] || { echo "usage: $0 <outdir>" >&2; exit 2; }
out="$1"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

names=(
  opa-authorizer
  kore-postgresql-api
  kore-policy-templates
  kore-policy-constraints
  kore-policy-sync
  kore-hostname-ownership-templates
  kore-hostname-ownership
  kore-workload-defaults-templates
  kore-workload-defaults
  kore-pvc-ownership-templates
  kore-pvc-ownership
  kore-local-tls
  kore-platform-config
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for name in "${names[@]}"; do
  chart="$(jq -r --arg n "$name" '.components[] | select(.name == $n and .phase == "configuration") | .chart // empty' "$root/infra/catalog/components.yaml")"
  source="$(jq -r --arg n "$name" '.components[] | select(.name == $n and .phase == "configuration") | .source // empty' "$root/infra/catalog/components.yaml")"
  stage="$work/$name"
  if [ -n "$chart" ]; then
    mkdir -p "$stage"
    cp -R "$root/$chart/." "$stage/"
    # The catalog name owns the published chart name: helm names the file and the
    # OCI path after Chart.yaml, which can differ (platform-certificate).
    sed -i.bak "s/^name:.*/name: $name/" "$stage/Chart.yaml"
    rm "$stage/Chart.yaml.bak"
  elif [ -n "$source" ]; then
    mkdir -p "$stage/templates" "$stage/manifests"
    (cd "$root/$source" && find . -name '*.yaml' -print0 | tar -cf - --null -T -) | tar -xf - -C "$stage/manifests"
    printf 'apiVersion: v2\nname: %s\ndescription: Platform configuration packaged from %s\ntype: application\nversion: 0.0.0\n' "$name" "$source" > "$stage/Chart.yaml"
    cat > "$stage/templates/manifests.yaml" <<'TEMPLATE'
{{- range $path, $_ := .Files.Glob "manifests/**.yaml" }}
---
{{ $.Files.Get $path }}
{{- end }}
TEMPLATE
  else
    echo "$name: no chart or source in the configuration phase of the catalog" >&2
    exit 1
  fi
  hash="$(cd "$stage" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do printf '%s  %s\n' "$(shasum -a 256 < "$file" | cut -d' ' -f1)" "$file"; done | shasum -a 256 | cut -c1-12)"
  version="0.0.0-$hash"
  helm package "$stage" --version "$version" --app-version "$version" --destination "$out" > /dev/null
  jq -nc --arg name "$name" --arg version "$version" --arg file "$name-$version.tgz" '{name: $name, version: $version, file: $file}'
done
