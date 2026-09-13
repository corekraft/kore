# OpenTofu modules

Provider modules are intentionally empty until a managed environment is selected
by an architectural decision. Local Minikube has no external substrate to own.
The stack boundary below reserves state ownership for future networking, identity,
registry, and managed Kubernetes modules without mixing it with Helm state.

