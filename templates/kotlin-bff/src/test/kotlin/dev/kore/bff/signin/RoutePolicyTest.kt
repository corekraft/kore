package dev.kore.bff.signin

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.util.AntPathMatcher

class RoutePolicyTest {
    private val matcher = AntPathMatcher()

    private fun isPublic(path: String): Boolean =
        RoutePolicy.publicPatterns.any { matcher.match(it, path) }

    @Test
    fun `only the health probes and the sign-in routes are public, and every other path needs a session`() {
        val publicPaths = listOf(
            "/actuator/health",
            "/actuator/health/liveness",
            "/actuator/health/readiness",
            "/login",
            "/oauth2/authorization/golden-path",
            "/login/oauth2/code/golden-path",
        )
        val protectedPaths = listOf(
            "/",
            "/api/orders",
            "/api/whoami",
            "/actuator/env",
            "/actuator/healthz",
            "/actuator/health-admin",
            "/oauth2x",
        )
        assertEquals(publicPaths, publicPaths.filter(::isPublic))
        assertEquals(emptyList<String>(), protectedPaths.filter(::isPublic))
    }
}
