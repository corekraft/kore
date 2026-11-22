package dev.kore.bff.signin

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpResponse

// The Spring wiring proof: real HTTP against the started application, with a
// fake OIDC issuer on loopback. It is an integration test, not a unit test.

@RestController
class PingController {
    @GetMapping("/api/ping")
    fun ping(): String = "pong"
}

internal class Http(private val base: String) {
    private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    fun get(path: String): HttpResponse<String> =
        client.send(
            java.net.http.HttpRequest.newBuilder(URI.create(base + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString(),
        )
}

@SpringBootTest(webEnvironment = RANDOM_PORT)
class SigninOffFlowTest {
    @Value("\${local.server.port}")
    private var port: Int = 0

    @Test
    fun `with sign-in off the health probe and the existing route answer as before, with no session cookie`() {
        val http = Http("http://localhost:$port")
        assertEquals(200, http.get("/actuator/health").statusCode())
        val ping = http.get("/api/ping")
        assertEquals(200, ping.statusCode())
        assertEquals("pong", ping.body())
        assertTrue(ping.headers().allValues("Set-Cookie").isEmpty())
    }
}

@SpringBootTest(
    webEnvironment = RANDOM_PORT,
    properties = [
        "GOLDEN_PATH_SIGNIN=true",
        "OIDC_CLIENT_ID=golden-path",
        "OIDC_CLIENT_SECRET=test-only-secret-value",
    ],
)
class SigninOnFlowTest {
    companion object {
        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("OIDC_ISSUER_URI") { FakeIssuer.uri }
        }
    }

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Test
    fun `an unauthenticated request to a protected route is refused and sent to sign-in, never served`() {
        val response = Http("http://localhost:$port").get("/api/ping")
        assertEquals(302, response.statusCode())
        val location = response.headers().firstValue("Location").orElse("")
        assertEquals("/oauth2/authorization/golden-path", URI.create(location).path)
        assertFalse(response.body().contains("pong"))
    }

    @Test
    fun `the health probe stays public with sign-in on`() {
        assertEquals(200, Http("http://localhost:$port").get("/actuator/health").statusCode())
    }

    @Test
    fun `the session cookie is host-only, HttpOnly, Secure and SameSite lax`() {
        val response = Http("http://localhost:$port").get("/oauth2/authorization/golden-path")
        val cookie = response.headers().allValues("Set-Cookie").single { it.startsWith("JSESSIONID=") }
        val attributes = cookie.split(";").map { it.trim() }.drop(1)
        assertEquals(setOf("Path=/", "Secure", "HttpOnly", "SameSite=Lax"), attributes.toSet())
        assertFalse(cookie.contains("Domain=", ignoreCase = true), cookie)
    }
}
