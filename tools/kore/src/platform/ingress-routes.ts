// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method

/**
 * The routes the load exercises: the reference app's, served by the platform
 * Gateway, each with the status it must answer with. `/api/protected` is
 * denied without a principal, so it exercises the authorizer path too.
 */
export const ingressRoutes: readonly { path: string; status: number }[] = [
  { path: "/livez", status: 200 },
  { path: "/readyz", status: 200 },
  { path: "/api", status: 200 },
  { path: "/api/protected", status: 403 },
];
