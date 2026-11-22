package dev.kore.bff.signin

import org.springframework.context.annotation.Conditional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * The authenticated probe for the golden-path sign-in flow. It is registered
 * only while sign-in is on; with the flag off, /api/whoami answers 404. The
 * path is not in RoutePolicy, so a request without a session is redirected to
 * sign-in before it reaches here. The body is fixed and names nothing about
 * the caller, and the route logs nothing.
 */
@RestController
@Conditional(SigninEnabledCondition::class)
class WhoamiController {
    @GetMapping("/api/whoami")
    fun whoami(): WhoamiResponse = WhoamiResponse(signedIn = true)
}

data class WhoamiResponse(val signedIn: Boolean)
