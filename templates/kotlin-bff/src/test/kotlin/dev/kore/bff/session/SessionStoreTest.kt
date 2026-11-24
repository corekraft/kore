package dev.kore.bff.session

import dev.kore.bff.Application
import dev.kore.bff.signin.FakeIssuer
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextImpl
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.session.Session
import org.springframework.session.SessionRepository
import org.springframework.session.jdbc.JdbcIndexedSessionRepository
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.Base64
import javax.sql.DataSource

// The session store through the real application: two replicas (two contexts)
// share one database, as two pods share the claimed PostgreSQL database. H2
// stands in for PostgreSQL; SessionSchemaTest covers the PostgreSQL-only lock.
// Integration tests: they start the whole application.

private fun replica(vararg extra: String): ConfigurableApplicationContext =
    SpringApplicationBuilder(Application::class.java)
        .properties(
            "spring.jmx.enabled=false",
            "GOLDEN_PATH_SIGNIN=true",
            "OIDC_ISSUER_URI=${FakeIssuer.uri}",
            "OIDC_CLIENT_ID=golden-path",
            "OIDC_CLIENT_SECRET=test-only-secret-value",
            "spring.datasource.url=jdbc:h2:mem:shared-sessions;DB_CLOSE_DELAY=-1",
            "spring.datasource.username=sa",
            "spring.datasource.password=test-only-password-value",
            *extra,
        )
        .run("--server.port=0")

private fun ConfigurableApplicationContext.port(): Int =
    environment.getProperty("local.server.port")!!.toInt()

private fun ConfigurableApplicationContext.get(path: String, cookie: String? = null): HttpResponse<String> {
    val request = HttpRequest.newBuilder(URI.create("http://localhost:${port()}$path")).GET()
    if (cookie != null) request.header("Cookie", cookie)
    return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()
        .send(request.build(), HttpResponse.BodyHandlers.ofString())
}

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SessionStoreOnTest {
    private lateinit var first: ConfigurableApplicationContext
    private lateinit var second: ConfigurableApplicationContext

    @BeforeAll
    fun start() {
        first = replica()
        second = replica()
    }

    @AfterAll
    fun stop() {
        first.close()
        second.close()
    }

    @Suppress("UNCHECKED_CAST")
    private fun repository(context: ConfigurableApplicationContext) =
        context.getBean(SessionRepository::class.java) as SessionRepository<Session>

    @Test
    fun `with sign-in on the sessions live in the database, so both replicas start against the one schema`() {
        assertNotNull(first.getBean(DataSource::class.java))
        assertTrue(repository(first) is JdbcIndexedSessionRepository, repository(first).toString())
        assertTrue(repository(second) is JdbcIndexedSessionRepository, repository(second).toString())
    }

    @Test
    fun `a session lasts 30 minutes from its last request`() {
        assertEquals(Duration.ofMinutes(30), repository(first).createSession().maxInactiveInterval)
    }

    @Test
    fun `expired sessions are deleted on a five minute schedule`() {
        assertEquals("0 */5 * * * *", first.environment.getProperty("spring.session.jdbc.cleanup-cron"))
    }

    @Test
    fun `a session a signed-in user got on one replica signs them in on the other`() {
        val session = repository(first).createSession()
        session.setAttribute(
            HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
            SecurityContextImpl(
                UsernamePasswordAuthenticationToken("probe-subject", null, listOf(SimpleGrantedAuthority("ROLE_USER"))),
            ),
        )
        repository(first).save(session)
        val cookie = "SESSION=" + Base64.getEncoder().encodeToString(session.id.toByteArray())

        val answered = second.get("/api/whoami", cookie)

        assertEquals(200, answered.statusCode())
        assertEquals("""{"signedIn":true}""", answered.body())
    }

    @Test
    fun `the authorization request started on one replica is found by the replica the callback lands on`() {
        val started = first.get("/oauth2/authorization/golden-path")
        assertEquals(302, started.statusCode())
        val cookie = started.headers().allValues("Set-Cookie").single { it.startsWith("SESSION=") }.substringBefore(";")
        val id = String(Base64.getDecoder().decode(cookie.removePrefix("SESSION=")))

        val onOtherReplica = repository(second).findById(id)

        assertNotNull(onOtherReplica, "the session the sign-in started is not in the shared store")
        assertTrue(
            onOtherReplica!!.attributeNames.any { it.contains("AUTHORIZATION_REQUEST") },
            onOtherReplica.attributeNames.toString(),
        )
    }

    @Test
    fun `a request with no session cookie is still sent to sign-in, never served`() {
        val response = second.get("/api/whoami")
        assertEquals(302, response.statusCode())
        assertEquals("/oauth2/authorization/golden-path", URI.create(response.headers().firstValue("Location").get()).path)
    }
}

class SessionStoreOffTest {
    @Test
    fun `with sign-in off there is no database and no JDBC session, so the context refreshes with none reachable`() {
        val context = SpringApplicationBuilder(Application::class.java)
            .properties("spring.jmx.enabled=false")
            .run("--server.port=0")
        try {
            assertTrue(context.getBeansOfType(DataSource::class.java).isEmpty())
            assertTrue(context.getBeansOfType(JdbcIndexedSessionRepository::class.java).isEmpty())
            assertEquals(200, context.get("/actuator/health").statusCode())
            assertTrue(context.get("/api/whoami").headers().allValues("Set-Cookie").isEmpty())
        } finally {
            context.close()
        }
    }

    @Test
    fun `with sign-in on and no database configured it refuses to start, naming the missing variable`() {
        val error = org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) {
            SpringApplicationBuilder(Application::class.java)
                .properties(
                    "spring.jmx.enabled=false",
                    "GOLDEN_PATH_SIGNIN=true",
                    "OIDC_ISSUER_URI=${FakeIssuer.uri}",
                    "OIDC_CLIENT_ID=golden-path",
                    "OIDC_CLIENT_SECRET=test-only-secret-value",
                )
                .run("--server.port=0")
        }
        var cause: Throwable? = error
        val messages = mutableListOf<String>()
        while (cause != null) { messages += cause.message.orEmpty(); cause = cause.cause }
        assertTrue(messages.any { it.contains("SPRING_DATASOURCE_URL is not set") }, messages.toString())
        assertFalse(messages.any { it.contains("test-only") }, messages.toString())
    }
}
