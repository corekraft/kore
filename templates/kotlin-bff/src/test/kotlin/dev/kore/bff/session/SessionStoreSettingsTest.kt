package dev.kore.bff.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SessionStoreSettingsTest {
    private val complete = mapOf(
        "spring.datasource.url" to "jdbc:h2:mem:example-sessions",
        "spring.datasource.username" to "app",
        "spring.datasource.password" to "test-only-password-value",
    )

    private fun from(variables: Map<String, String>) = SessionStoreSettings.from { variables[it] }

    @Test
    fun `reads the URL, username and password from the three datasource properties`() {
        val settings = from(complete)
        assertEquals("jdbc:h2:mem:example-sessions", settings.url)
        assertEquals("app", settings.username)
        assertEquals("test-only-password-value", settings.password())
    }

    @Test
    fun `a missing or blank value refuses to start, naming the environment variable and the chart that sets it`() {
        for ((property, variable) in listOf(
            "spring.datasource.url" to "SPRING_DATASOURCE_URL",
            "spring.datasource.username" to "SPRING_DATASOURCE_USERNAME",
            "spring.datasource.password" to "SPRING_DATASOURCE_PASSWORD",
        )) {
            for (value in listOf(null, " ")) {
                val variables = complete.toMutableMap().also { if (value == null) it.remove(property) else it[property] = value }
                val error = assertThrows(IllegalStateException::class.java) { from(variables) }
                assertEquals(
                    "$variable is not set; golden-path-signin keeps its sessions in the database the Service's chart claims, which sets SPRING_DATASOURCE_URL, SPRING_DATASOURCE_USERNAME and SPRING_DATASOURCE_PASSWORD",
                    error.message,
                )
            }
        }
    }

    @Test
    fun `printing the settings never shows the password`() {
        val printed = from(complete).toString()
        assertFalse(printed.contains("test-only-password-value"), printed)
    }
}
