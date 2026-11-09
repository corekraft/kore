#!/bin/sh
# Run `tofu validate` in every directory under infra/tofu/stacks that holds
# .tf files. Passes when there are none. Initialises without a backend, so no
# state or credentials are touched; provider plugins are downloaded.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
stacks="$root/infra/tofu/stacks"
count=0
for directory in $(find "$stacks" -name '*.tf' -exec dirname {} \; | sort -u); do
  count=$((count + 1))
  echo "tofu validate: ${directory#"$root"/}"
  tofu -chdir="$directory" init -backend=false -input=false -no-color >/dev/null
  tofu -chdir="$directory" validate -no-color
done
echo "validated $count tofu stack(s)"
