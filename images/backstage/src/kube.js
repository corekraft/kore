// Read-only list of the platform Organization and Service objects through the
// Kubernetes API, with the pod's own token (a ClusterRole that can only get
// and list these two resources). The user-facing Kubernetes plugin never uses
// this: it reads as the signed-in user.
const API = "https://kubernetes.default.svc/apis/platform.kore.dev/v1alpha1";

async function list(resource, { fetch, token }) {
  const response = await fetch(`${API}/${resource}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `listing ${resource} failed with status ${response.status}; check the backstage ClusterRole`,
    );
  }
  return (await response.json()).items ?? [];
}

export async function listPlatformObjects({ fetch, readToken }) {
  const token = (await readToken()).trim();
  return {
    organizations: await list("organizations", { fetch, token }),
    services: await list("services", { fetch, token }),
  };
}
