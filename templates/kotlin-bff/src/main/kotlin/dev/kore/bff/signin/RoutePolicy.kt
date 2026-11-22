package dev.kore.bff.signin

/** Which paths reach the application without a session once sign-in is on. */
object RoutePolicy {
    /**
     * Ant-style patterns for the health probes and the sign-in routes. Every
     * other path needs a signed-in session.
     */
    val publicPatterns: List<String> = listOf(
        "/actuator/health",
        "/actuator/health/**",
        "/login",
        "/oauth2/**",
        "/login/oauth2/**",
    )
}
