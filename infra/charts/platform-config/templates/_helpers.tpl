{{/*
True (a non-empty string) only for the agentgateway class with the
agentgateway-mesh-enrollment flag on; any other class or flag state renders as
before. kore hands every declared flag to this chart as features.<flag>.
*/}}
{{- define "platform-config.agentgatewayEnrolled" -}}
{{- if and (eq .Values.gateway.className "agentgateway") (index (.Values.features | default dict) "agentgateway-mesh-enrollment") -}}true{{- end -}}
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
The Gateway Service's port: the standard port with the shared Gateway on, which
reaches the listener through targetPort; otherwise the listener's own port.
*/}}
{{- define "platform-config.servicePort" -}}
{{- if include "platform-config.sharedGateway" . -}}{{ .Values.gateway.sharedServicePort }}{{- else -}}{{ .Values.gateway.port }}{{- end -}}
{{- end -}}
