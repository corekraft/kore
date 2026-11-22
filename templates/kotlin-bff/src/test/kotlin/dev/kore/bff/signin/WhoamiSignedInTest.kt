package dev.kore.bff.signin

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import jakarta.servlet.Filter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.mock.web.MockHttpSession
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextImpl
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.context.WebApplicationContext

// The signed-in half of the whoami route, through the real filter chain. A
// session that already holds an authenticated SecurityContext stands in for
// a completed sign-in; the OIDC round trip is covered by SigninFlowTest.
@SpringBootTest(
    properties = [
        "GOLDEN_PATH_SIGNIN=true",
        "OIDC_CLIENT_ID=golden-path",
        "OIDC_CLIENT_SECRET=test-only-secret-value",
    ],
)
class WhoamiSignedInTest {
    companion object {
        private const val SUBJECT = "probe-subject-7f3a"
        private const val SESSION_ID = "probe-session-5c9e1d"

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("OIDC_ISSUER_URI") { FakeIssuer.uri }
        }
    }

    @Autowired
    private lateinit var context: WebApplicationContext

    private val mockMvc: MockMvc by lazy {
        MockMvcBuilders.webAppContextSetup(context)
            .addFilters<DefaultMockMvcBuilder>(context.getBean("springSecurityFilterChain", Filter::class.java))
            .build()
    }

    private fun signedInSession(): MockHttpSession {
        val authentication = UsernamePasswordAuthenticationToken(
            SUBJECT,
            null,
            listOf(SimpleGrantedAuthority("ROLE_USER")),
        )
        return MockHttpSession(null, SESSION_ID).apply {
            setAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                SecurityContextImpl(authentication),
            )
        }
    }

    @Test
    fun `a signed-in session gets 200 and the fixed body, with no token, claim, name or session id`() {
        val response = mockMvc.perform(get("/api/whoami").session(signedInSession())).andReturn().response
        assertEquals(200, response.status)
        assertEquals("""{"signedIn":true}""", response.contentAsString)
    }

    @Test
    fun `answering a signed-in session logs neither its subject nor its session id`() {
        val session = signedInSession()
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        root.addAppender(appender)
        try {
            mockMvc.perform(get("/api/whoami").session(session))
        } finally {
            root.detachAppender(appender)
        }
        val logged = appender.list.map { it.formattedMessage }
        assertFalse(logged.any { it.contains(SUBJECT) }, logged.toString())
        assertFalse(logged.any { it.contains(session.id) }, logged.toString())
    }
}
