# Kotlin BFF template

Golden-path template for a Kotlin Spring Boot backend for frontend
([ADR 0046](../../docs/decisions/0046-bff-jvm-with-agent-and-aot-cache.md)).

- Jib builds the image on the pinned GraalVM JDK, run as a JVM. The base is the
  Oracle Linux 9 variant of JDK 25.0.2, which starts on x86-64-v2 hosts
  ([ADR 0144](../../docs/decisions/0144-run-the-kotlin-bff-on-the-ol9-graalvm-base-so-it-starts-on-x86-64-v2-hosts.md)).
- The OpenTelemetry Java agent is downloaded by version and checked against its
  pinned SHA-256 before it is used.
- `aotTraining` runs the app once in the same base image with the agent, stops
  after the Spring context refreshes, and writes the JDK AOT cache that Jib adds
  as a layer.

Build: `gradle jib --image=<ref>` (needs Docker for the training run). Nothing
deploys this template yet; the live build and startup measurement are owed.

## Sign-in

Sign-in is behind the `golden-path-signin` flag, off in every environment
overlay. The Service's chart passes the flag to the application as
`GOLDEN_PATH_SIGNIN`, and only the exact value `true` turns the flow on. A
value that is neither `true` nor `false` refuses to start.

With the flag off, every route answers as it did before sign-in existed, and no
session is created.

The flow adds one authenticated probe, `GET /api/whoami`, under `/api` so the
delivered route reaches it. With sign-in on, a signed-in session gets 200 and
`{"signedIn":true}`, with no token, claim, name or session id in it. Without a
session the request is redirected to `/oauth2/authorization/golden-path`, never
answered 200. With the flag off it answers 404.

With the flag on, set these three environment variables at run time. They are
never committed, and the client secret is never logged or printed:

- `OIDC_ISSUER_URI`: the OIDC provider's issuer. Discovery is read from it when
  the application starts.
- `OIDC_CLIENT_ID`: the client id the provider issued.
- `OIDC_CLIENT_SECRET`: the client secret the provider issued.

A missing or blank variable refuses to start, and the message names it. The
session cookie is host-only, HttpOnly, Secure and SameSite lax. Every path
except the health probes (`/actuator/health`) and the sign-in routes needs a
signed-in session; an unauthenticated request is redirected to sign-in and
never served.

## Session store

With sign-in on, the session and the OAuth2 authorization request live in a
PostgreSQL database through Spring Session JDBC
([ADR 0182](../../docs/decisions/0182-the-golden-path-bff-keeps-its-session-in-the-platform-postgresql-database.md)),
so a callback that lands on another replica finds them and the signed-in BFF can
run more than one replica. The Service's chart claims the database through the
platform PostgreSQL API and passes its connection by reference as
`SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and
`SPRING_DATASOURCE_PASSWORD`; set these at run time. They are never committed, the
password is never logged or printed, and a missing one refuses to start and names
it. `application.yaml` holds no connection value.

- With sign-in off there is no datasource, no JDBC session and no session cookie,
  so the AOT training and verify runs need no database.
- The tables are created at start by an idempotent script under a PostgreSQL
  advisory lock, so replicas that start together do not race.
- A session lasts 30 minutes from its last request, and each replica deletes
  expired rows every five minutes.
- The database is not part of `/actuator/health`: a database blip does not
  restart or unready the replicas.
- The session cookie is named `SESSION`; its attributes are unchanged.

This replaces the one-replica rule of issue 1837. The signed-in scale-out and
high-availability claims wait for the live runs on issue 1841.

Pinned sign-in dependencies and their evidence are in
[`infra/catalog/compatibility.md`](../../infra/catalog/compatibility.md).
