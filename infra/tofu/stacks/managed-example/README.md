# Managed environment stack (opt-in)

A minimal OpenTofu stack for the `managed-example` environment. It pins OpenTofu
and every provider to exact versions, declares no backend and no credentials, and
creates no cloud resource. It is validated offline and **never applied** by Kore
or CI:

```sh
mise run validate-tofu   # tofu init -backend=false && tofu validate, per stack
```

Add provider modules only after a reviewed portability decision and offline plan
tests. Changing a pin follows the `pin-upgrade` skill; the offline test
`tools/kore/src/diagnostics/tofu-stack.spec.ts` rejects ranges.
