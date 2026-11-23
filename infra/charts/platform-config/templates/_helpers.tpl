{{/*
True (a non-empty string) only for the agentgateway class with the
agentgateway-mesh-enrollment flag on; any other class or flag state renders as
before. kore hands every declared flag to this chart as features.<flag>.
*/}}
{{- define "platform-config.agentgatewayEnrolled" -}}
{{- if and (eq .Values.gateway.className "agentgateway") (index (.Values.features | default dict) "agentgateway-mesh-enrollment") -}}true{{- end -}}
{{- end -}}

{{/*
True (a non-empty string) only for the agentgateway class with the
agentgateway-data-plane-metrics flag on. The Gateway then asks the data-plane
pods to be scraped (issue 1514); any other state renders as before.
*/}}
{{- define "platform-config.agentgatewayMetrics" -}}
{{- if and (eq .Values.gateway.className "agentgateway") (index (.Values.features | default dict) "agentgateway-data-plane-metrics") -}}true{{- end -}}
{{- end -}}

{{/*
True (a non-empty string) only while the platform-shared-gateway flag is on: the
Gateway gains the platform organization's wildcard listener and its certificate,
and its Service serves the standard port (ADR 0132). Off, nothing it renders
changes.
*/}}
{{- define "platform-config.sharedGateway" -}}
{{- if index (.Values.features | default dict) "platform-shared-gateway" -}}true{{- end -}}
{{- end -}}

{{/*
The namespaces a Gateway listener admits routes from. Off, every namespace, as
before. On, only namespaces carrying the platform-owned label that the platform
charts and the delivery ApplicationSet set (ADR 0133).
*/}}
{{- define "platform-config.routeNamespaces" -}}
{{- if include "platform-config.sharedGateway" . -}}
{from: Selector, selector: {matchLabels: {platform.kore.dev/shared-gateway: "true"}}}
{{- else -}}
{from: All}
{{- end -}}
{{- end -}}

{{/*
The Gateway Service's port: the standard port with the shared Gateway on, which
reaches the listener through targetPort; otherwise the listener's own port.
*/}}
{{- define "platform-config.servicePort" -}}
{{- if include "platform-config.sharedGateway" . -}}{{ .Values.gateway.sharedServicePort }}{{- else -}}{{ .Values.gateway.port }}{{- end -}}
{{- end -}}

{{/*
The name of the standard-port entry the overlay adds to the Gateway Service with
the shared Gateway on. The controller generates the listener port (8443) under
its own name (agentgateway: listener-<port>; Istio: the first listener's name,
`https`, beside status-port), and the overlay's port is a different number, so
the merge appends it as a new entry. Kubernetes requires every port to be named
once a Service has more than one, and the name must differ from the generated
ones.
*/}}
{{- define "platform-config.servicePortName" -}}
https-standard
{{- end -}}

{{/*
True (a non-empty string) only while the registry-by-name flag is on: the Gateway
gains a TLS passthrough listener for the registry's name, on the same port as its
HTTPS listeners, so host-side callers reach the registry's own proxy with its own
certificate (ADR 0132). Off, nothing it renders changes.
*/}}
{{- define "platform-config.registryByName" -}}
{{- if index (.Values.features | default dict) "registry-by-name" -}}true{{- end -}}
{{- end -}}

{{/*
The name Keycloak answers to under the platform organization, keycloak.<organization>.<domain>:
the platform wildcard without its leading "*.", under "keycloak.". It is the host the
Keycloak chart and the portal take from kore, so the listener and the route agree.
*/}}
{{- define "platform-config.keycloakHostname" -}}
{{- printf "keycloak.%s" (trimPrefix "*." (required "set gateway.platformHostname, or render through kore, which derives it from the environment's platform field" .Values.gateway.platformHostname)) -}}
{{- end -}}

{{/*
The name the registry answers to, registry.<organization>.<domain>: the platform
wildcard without its leading "*.", under "registry.". Derived from the one value
kore passes, so the Helm path and the Argo CD Application agree.
*/}}
{{- define "platform-config.registryHostname" -}}
{{- printf "registry.%s" (trimPrefix "*." (required "set gateway.platformHostname, or render through kore, which derives it from the environment's platform field" .Values.gateway.platformHostname)) -}}
{{- end -}}

{{/*
The name of the passthrough listener. The registry chart's route names it as its
sectionName; an integration spec holds the two together.
*/}}
{{- define "platform-config.registryListenerName" -}}
tls-registry
{{- end -}}

{{/*
True (a non-empty string) only while the database-routes flag is on: the Gateway
gains a TLS passthrough listener on the database port, and, where the overlay
sets a node port, its Service a second port for it. Off, nothing it renders
changes.
*/}}
{{- define "platform-config.databaseRoutes" -}}
{{- if index (.Values.features | default dict) "database-routes" -}}true{{- end -}}
{{- end -}}

{{/*
The Gateway Service ports the overlay adds: the standard port with the shared
Gateway on, and the database port when database-routes is on and the overlay
sets its node port. Rendered as the `ports:` entries of the Service overlay,
or nothing. The database entry carries the port and the name of its listener,
so the merge on `port` updates the controller's generated entry in place and
every port stays named.
*/}}
{{- define "platform-config.servicePorts" -}}
{{- if .Values.gateway.service.nodePort }}
- port: {{ include "platform-config.servicePort" . }}
  {{- if include "platform-config.sharedGateway" . }}
  name: {{ include "platform-config.servicePortName" . }}
  targetPort: {{ .Values.gateway.port }}
  {{- end }}
  nodePort: {{ .Values.gateway.service.nodePort }}
{{- end }}
{{- if and (include "platform-config.databaseRoutes" .) .Values.gateway.database.nodePort }}
- port: {{ .Values.gateway.database.port }}
  name: {{ include "platform-config.databasePortName" . }}
  nodePort: {{ .Values.gateway.database.nodePort }}
{{- end }}
{{- end -}}

{{/*
The name of the database listener and of its Service port. Istio names the
generated port after the listener; agentgateway names it listener-<port>, which
the overlay's entry renames in place.
*/}}
{{- define "platform-config.databasePortName" -}}
postgres
{{- end -}}
