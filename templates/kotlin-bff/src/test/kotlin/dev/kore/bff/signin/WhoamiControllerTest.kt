package dev.kore.bff.signin

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class WhoamiControllerTest {
    @Test
    fun `the whoami route answers only the fixed signed-in value, with no detail about the caller`() {
        assertEquals(WhoamiResponse(signedIn = true), WhoamiController().whoami())
    }
}
