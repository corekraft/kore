# Sourced by the husky hooks. `pinned CMD...` runs CMD through the pinned
# toolchain (`mise exec --`), so node, npm and the node_modules/.bin shebangs
# never resolve an unpinned node from PATH. Without mise it fails, never falls back.
pinned() {
  command -v mise >/dev/null 2>&1 || {
    echo "git hook: mise is not installed; install it from https://mise.jdx.dev and run 'mise install'" >&2
    exit 1
  }
  mise exec -- "$@"
}
