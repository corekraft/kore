package dev.kore.bff.signin

/**
 * Whether the golden-path sign-in flow is on for this run. The Service's chart
 * passes the golden-path-signin flag as GOLDEN_PATH_SIGNIN. The flow is off
 * unless that variable is exactly true, and the OIDC variables are read only
 * when it is on.
 */
sealed interface SigninSettings {
    /** The flow is off: no sign-in, and no OIDC variable is read. */
    data object Disabled : SigninSettings

    /** The flow is on, with its three run-time settings. */
    class Enabled(
        val issuerUri: String,
        val clientId: String,
        private val secret: String,
    ) : SigninSettings {
        /** The client secret, for the OAuth2 client only. Never log or print it. */
        fun clientSecret(): String = secret

        override fun toString(): String =
            "Enabled(issuerUri=$issuerUri, clientId=$clientId, clientSecret=***)"
    }

    companion object {
        const val FLAG_VARIABLE = "GOLDEN_PATH_SIGNIN"

        /** Reads the settings through [lookup], which returns a variable's value or null. */
        fun from(lookup: (String) -> String?): SigninSettings {
            val flag = lookup(FLAG_VARIABLE)?.takeIf { it.isNotBlank() } ?: return Disabled
            return when (flag) {
                "false" -> Disabled
                "true" -> Enabled(
                    issuerUri = required(lookup, "OIDC_ISSUER_URI"),
                    clientId = required(lookup, "OIDC_CLIENT_ID"),
                    secret = required(lookup, "OIDC_CLIENT_SECRET"),
                )
                else -> throw IllegalArgumentException(
                    "$FLAG_VARIABLE must be true or false, not \"$flag\"; the Service's chart sets it from the golden-path-signin flag",
                )
            }
        }

        private fun required(lookup: (String) -> String?, name: String): String =
            lookup(name)?.takeIf { it.isNotBlank() }
                ?: throw IllegalStateException(
                    "$name is not set; golden-path-signin needs OIDC_ISSUER_URI, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET at run time",
                )
    }
}
