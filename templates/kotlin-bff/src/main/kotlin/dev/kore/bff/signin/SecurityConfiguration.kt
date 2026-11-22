package dev.kore.bff.signin

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.oauth2.client.registration.ClientRegistration
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository
import org.springframework.security.oauth2.client.registration.ClientRegistrations
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository
import org.springframework.security.web.SecurityFilterChain

/**
 * The one filter chain. Off, it permits every request and sends no security
 * header, so the routes answer as they did before sign-in existed. On, it
 * requires a session for every path outside RoutePolicy and signs in through
 * the OIDC provider.
 */
@Configuration(proxyBeanMethods = false)
class SecurityConfiguration {
    @Bean
    fun signinSettings(environment: Environment): SigninSettings =
        SigninSettings.from { environment.getProperty(it) }

    @Bean
    fun clientRegistrationRepository(settings: SigninSettings): ClientRegistrationRepository =
        when (settings) {
            SigninSettings.Disabled -> NoClientRegistrations
            is SigninSettings.Enabled -> InMemoryClientRegistrationRepository(
                ClientRegistrations.fromIssuerLocation(settings.issuerUri)
                    .registrationId(REGISTRATION_ID)
                    .clientId(settings.clientId)
                    .clientSecret(settings.clientSecret())
                    .scope("openid", "profile")
                    .build(),
            )
        }

    @Bean
    fun filterChain(http: HttpSecurity, settings: SigninSettings): SecurityFilterChain =
        when (settings) {
            SigninSettings.Disabled -> http
                .authorizeHttpRequests { it.anyRequest().permitAll() }
                .csrf { it.disable() }
                .headers { it.disable() }
                .build()
            is SigninSettings.Enabled -> http
                .authorizeHttpRequests {
                    it.requestMatchers(*RoutePolicy.publicPatterns.toTypedArray())
                        .permitAll()
                        .anyRequest()
                        .authenticated()
                }
                .oauth2Login { }
                .build()
        }

    companion object {
        const val REGISTRATION_ID = "golden-path"
    }

    /** With sign-in off there is no provider, and no discovery request is made. */
    private object NoClientRegistrations : ClientRegistrationRepository {
        override fun findByRegistrationId(registrationId: String): ClientRegistration? = null
    }
}
