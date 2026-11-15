# Golden-path static frontend template (ADR 0045): the build is copied into a
# pinned, minimal static-server image that is signed and deployed by digest.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
# Links the GHCR package to the public repository so it is published publicly.
LABEL org.opencontainers.image.source="https://github.com/corekraft/kore"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY src/ /usr/share/nginx/html/
# The base image already runs as the unprivileged nginx user (uid 101).
EXPOSE 8080
