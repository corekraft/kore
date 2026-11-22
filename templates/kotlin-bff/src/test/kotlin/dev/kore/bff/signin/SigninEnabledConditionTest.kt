package dev.kore.bff.signin

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.context.annotation.ConditionContext
import org.springframework.core.env.Environment
import org.springframework.core.type.AnnotatedTypeMetadata

class SigninEnabledConditionTest {
    private fun registers(variables: Map<String, String>): Boolean {
        val environment = mock(Environment::class.java)
        `when`(environment.getProperty(anyString())).thenAnswer { variables[it.getArgument<String>(0)] }
        val context = mock(ConditionContext::class.java)
        `when`(context.environment).thenReturn(environment)
        return SigninEnabledCondition().matches(context, mock(AnnotatedTypeMetadata::class.java))
    }

    private val complete = mapOf(
        "GOLDEN_PATH_SIGNIN" to "true",
        "OIDC_ISSUER_URI" to "https://issuer.example.test/realms/kore",
        "OIDC_CLIENT_ID" to "golden-path",
        "OIDC_CLIENT_SECRET" to "test-only-secret-value",
    )

    @Test
    fun `the whoami route is registered only when the flag is exactly true with its OIDC variables set`() {
        assertTrue(registers(complete))
    }

    @Test
    fun `the whoami route is not registered while the flag is absent or false, so the whoami path answers 404`() {
        assertFalse(registers(emptyMap()))
        assertFalse(registers(complete + ("GOLDEN_PATH_SIGNIN" to "false")))
    }
}
