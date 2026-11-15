// Read-only list of the platform Organization and Service objects through the
// Kubernetes API, with the pod's own token (a ClusterRole that can only get
// and list these two resources). The user-facing Kubernetes plugin never uses
// this: it reads as the signed-in user.
const API = "https://kubernetes.default.svc/apis/platform.kore.dev/v1alpha1";

// The expected failures of a read: the API refuses, is unreachable, or the
// pod has no token. Anything else is a bug and propagates.
export class PlatformReadError extends Error {}

async function list(resource, { fetch, token }) {
  let response;
  try {
    response = await fetch(`${API}/${resource}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (error) {
    throw new PlatformReadError(`listing ${resource} failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new PlatformReadError(
      `listing ${resource} failed with status ${response.status}; check the backstage ClusterRole`,
    );
  }
  return (await response.json()).items ?? [];
}

export async function listPlatformObjects({ fetch, readToken }) {
  let token;
  try {
    token = (await readToken()).trim();
  } catch (error) {
    throw new PlatformReadError(
      `reading the service account token failed: ${error.message}`,
    );
  }
  return {
    organizations: await list("organizations", { fetch, token }),
    services: await list("services", { fetch, token }),
  };
}
