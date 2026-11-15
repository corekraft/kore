{{/*
True (a non-empty string) only for the agentgateway class with the
agentgateway-mesh-enrollment flag on; any other class or flag state renders as
before. kore hands every declared flag to this chart as features.<flag>.
*/}}
{{- define "platform-config.agentgatewayEnrolled" -}}
{{- if and (eq .Values.gateway.className "agentgateway") (index (.Values.features | default dict) "agentgateway-mesh-enrollment") -}}true{{- end -}}
{{- end -}}
