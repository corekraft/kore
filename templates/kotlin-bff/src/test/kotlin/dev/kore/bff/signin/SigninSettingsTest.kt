package dev.kore.bff.signin

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SigninSettingsTest {
    private val complete = mapOf(
        "GOLDEN_PATH_SIGNIN" to "true",
        "OIDC_ISSUER_URI" to "https://issuer.example.test/realms/kore",
        "OIDC_CLIENT_ID" to "golden-path",
        "OIDC_CLIENT_SECRET" to "test-only-secret-value",
    )

    private fun from(variables: Map<String, String>): SigninSettings =
        SigninSettings.from { variables[it] }

    @Test
    fun `sign-in is off when the flag variable is absent, and then no OIDC variable is required`() {
        assertEquals(SigninSettings.Disabled, from(emptyMap()))
    }

    @Test
    fun `sign-in is off for the value false, even with OIDC variables set`() {
        assertEquals(
            SigninSettings.Disabled,
            from(mapOf("GOLDEN_PATH_SIGNIN" to "false", "OIDC_CLIENT_SECRET" to "x")),
        )
    }

    @Test
    fun `a blank flag variable counts as absent`() {
        assertEquals(SigninSettings.Disabled, from(mapOf("GOLDEN_PATH_SIGNIN" to " ")))
    }

    @Test
    fun `a flag value that is neither true nor false is refused, naming the variable and the value`() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            from(mapOf("GOLDEN_PATH_SIGNIN" to "yes"))
        }
        assertEquals(
            "GOLDEN_PATH_SIGNIN must be true or false, not \"yes\"; the Service's chart sets it from the golden-path-signin flag",
            error.message,
        )
    }

    @Test
    fun `enabled sign-in reads the issuer, client id and client secret from the three variables`() {
        val enabled = from(complete) as SigninSettings.Enabled
        assertEquals("https://issuer.example.test/realms/kore", enabled.issuerUri)
        assertEquals("golden-path", enabled.clientId)
        assertEquals("test-only-secret-value", enabled.clientSecret())
    }

    @Test
    fun `enabled sign-in refuses to start when a variable is missing, naming it and never a value`() {
        val error = assertThrows(IllegalStateException::class.java) {
            from(complete - "OIDC_CLIENT_SECRET")
        }
        assertEquals(
            "OIDC_CLIENT_SECRET is not set; golden-path-signin needs OIDC_ISSUER_URI, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET at run time",
            error.message,
        )
    }

    @Test
    fun `a blank OIDC variable counts as missing`() {
        val error = assertThrows(IllegalStateException::class.java) {
            from(complete + ("OIDC_CLIENT_ID" to ""))
        }
        assertEquals(
            "OIDC_CLIENT_ID is not set; golden-path-signin needs OIDC_ISSUER_URI, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET at run time",
            error.message,
        )
    }

    @Test
    fun `the enabled settings print without the client secret`() {
        val printed = from(complete).toString()
        assertFalse(printed.contains("test-only-secret-value"), printed)
        assertTrue(printed.contains("clientSecret=***"), printed)
    }
}
