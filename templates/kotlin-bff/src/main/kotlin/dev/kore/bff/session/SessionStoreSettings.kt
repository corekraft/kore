package dev.kore.bff.session

/**
 * Where the signed-in BFF keeps its sessions: the PostgreSQL database the platform
 * PostgreSQL API claimed for the Service. The Service's chart passes the
 * connection through the standard Spring datasource variables, read by reference
 * from the claim's connection output, so none of it is committed.
 */
class SessionStoreSettings(
    val url: String,
    val username: String,
    private val password: String,
) {
    /** The database password, for the connection pool only. Never log or print it. */
    fun password(): String = password

    override fun toString(): String = "SessionStoreSettings(url=$url, username=$username, password=***)"

    companion object {
        /** Reads the settings through [lookup], which returns a property's value or null. */
        fun from(lookup: (String) -> String?): SessionStoreSettings =
            SessionStoreSettings(
                url = required(lookup, "spring.datasource.url", "SPRING_DATASOURCE_URL"),
                username = required(lookup, "spring.datasource.username", "SPRING_DATASOURCE_USERNAME"),
                password = required(lookup, "spring.datasource.password", "SPRING_DATASOURCE_PASSWORD"),
            )

        private fun required(lookup: (String) -> String?, property: String, variable: String): String =
            lookup(property)?.takeIf { it.isNotBlank() }
                ?: throw IllegalStateException(
                    "$variable is not set; golden-path-signin keeps its sessions in the database the Service's chart claims, which sets SPRING_DATASOURCE_URL, SPRING_DATASOURCE_USERNAME and SPRING_DATASOURCE_PASSWORD",
                )
    }
}
