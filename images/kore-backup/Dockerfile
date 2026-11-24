# The kore-backup image (issue 1639, spec 1610): the kore-backup program on a
# distroless Node runtime, with pg_dump 18 and age copied from pinned builder
# stages. The runtime stage has no shell and no package manager (ADR 0116).
# Nothing deploys this image: the release workflow signs and locks it, and a
# later pull request pins its digest in the catalog. Build it from the program's
# context: docker build --file images/kore-backup/Dockerfile tools/kore

# Compiles the program. The output is plain JavaScript, so this stage can be anything.
FROM node:26.13.0-trixie@sha256:438603bbb5cda404b9416f0b5c8026f61501ab911760d861ec28c36b5d675725 AS program
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY integration ./integration
RUN npm ci --ignore-scripts \
    && npm run build

# pg_dump and age come from this stage. The PostgreSQL 18 client is the official
# trixie image's, the same Debian release as the runtime base and the newest major
# in use. age is the mise-pinned release, checked by its SHA-256 before it is installed.
FROM postgres:18-trixie@sha256:f5cbc081c25690710f3fc6f4c61a7565382bae01ca0d0f2028a53d7926b85a20 AS libraries
ARG AGE_VERSION=1.3.2
ARG AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
ADD https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz /tmp/age.tar.gz
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# The shared libraries pg_dump links are copied, except glibc, which the base already carries.
RUN set -eux; \
    echo "${AGE_SHA256}  /tmp/age.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/age.tar.gz -C /tmp; \
    mkdir -p /stage/usr/local/bin /stage/usr/lib/x86_64-linux-gnu; \
    install -m 0755 /tmp/age/age /stage/usr/local/bin/age; \
    install -m 0755 /usr/lib/postgresql/18/bin/pg_dump /stage/usr/local/bin/pg_dump; \
    ldd /usr/lib/postgresql/18/bin/pg_dump \
      | awk '$3 ~ /^\// { print $3 }' \
      | grep -v '/\(libc\|libm\|libpthread\|libdl\|libresolv\|libgcc_s\|libstdc++\)\.so' \
      | xargs -I{} cp -L {} /stage/usr/lib/x86_64-linux-gnu/

# The runtime stage: distroless Node 26 on Debian 13, run as the nonroot user.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
LABEL org.opencontainers.image.source="https://github.com/corekraft/kore"
COPY --from=libraries /stage/ /
COPY --from=program /src/package.json /app/package.json
COPY --from=program /src/dist/src /app/dist/src
ENV PATH=/usr/local/bin:/usr/bin:/bin
WORKDIR /app
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/src/cluster/backup-main.js"]
