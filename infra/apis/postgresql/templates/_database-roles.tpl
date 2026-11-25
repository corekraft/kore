{{- /* The database-role-split fragments (ADR 0171). The managed roles go into the Cluster and the role step goes before project-status, each only while databaseRoleSplit is on; the rotation period is the one the chart sets. Named templates, so both compositions take the same text. */ -}}
{{- define "postgresql.databaseRoles.managed" -}}
{{ .Files.Get "compositions/database-roles/managed.yaml" | trimSuffix "\n" }}
{{- end -}}
{{- define "postgresql.databaseRoles.step" -}}
{{ .Files.Get "compositions/database-roles/step.yaml" | replace "__ROTATION_PERIOD__" .Values.databaseRoles.rotationPeriod | trimSuffix "\n" }}
{{- end -}}
