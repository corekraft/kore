package dev.kore.bff.session

import org.springframework.beans.factory.InitializingBean
import java.sql.Connection
import javax.sql.DataSource

/**
 * Creates the Spring Session JDBC tables, safely when several replicas start at
 * once. Spring Session's own script is a plain CREATE TABLE, which fails on the
 * second start and when two replicas race. This one is idempotent, and on
 * PostgreSQL one transaction holds an advisory lock while it runs, so the
 * replicas take turns and the later ones find the tables in place.
 *
 * The statements copy Spring Session's schema-postgresql.sql, which a test
 * compares against the version the build pins.
 */
class SessionSchema(private val dataSource: DataSource) : InitializingBean {
    override fun afterPropertiesSet() = create()

    fun create() {
        dataSource.connection.use { connection ->
            val autoCommit = connection.autoCommit
            connection.autoCommit = false
            try {
                connection.createStatement().use { statement ->
                    if (isPostgreSql(connection)) statement.execute(LOCK)
                    STATEMENTS.forEach { statement.execute(it) }
                }
                connection.commit()
            } catch (failure: Exception) {
                connection.rollback()
                throw IllegalStateException(
                    "could not create the session tables in the session database: ${failure.message}; check SPRING_DATASOURCE_URL reaches the claimed database and its user may create tables",
                    failure,
                )
            } finally {
                connection.autoCommit = autoCommit
            }
        }
    }

    private fun isPostgreSql(connection: Connection): Boolean =
        connection.metaData.databaseProductName == "PostgreSQL"

    companion object {
        /** A transaction-scoped lock: released by the commit or the rollback, never left behind. */
        const val LOCK = "SELECT pg_advisory_xact_lock(1841)"

        val STATEMENTS: List<String> = listOf(
            """
            CREATE TABLE IF NOT EXISTS SPRING_SESSION (
                PRIMARY_ID CHAR(36) NOT NULL,
                SESSION_ID CHAR(36) NOT NULL,
                CREATION_TIME BIGINT NOT NULL,
                LAST_ACCESS_TIME BIGINT NOT NULL,
                MAX_INACTIVE_INTERVAL INT NOT NULL,
                EXPIRY_TIME BIGINT NOT NULL,
                PRINCIPAL_NAME VARCHAR(100),
                CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID)
            )
            """.trimIndent(),
            "CREATE UNIQUE INDEX IF NOT EXISTS SPRING_SESSION_IX1 ON SPRING_SESSION (SESSION_ID)",
            "CREATE INDEX IF NOT EXISTS SPRING_SESSION_IX2 ON SPRING_SESSION (EXPIRY_TIME)",
            "CREATE INDEX IF NOT EXISTS SPRING_SESSION_IX3 ON SPRING_SESSION (PRINCIPAL_NAME)",
            """
            CREATE TABLE IF NOT EXISTS SPRING_SESSION_ATTRIBUTES (
                SESSION_PRIMARY_ID CHAR(36) NOT NULL,
                ATTRIBUTE_NAME VARCHAR(200) NOT NULL,
                ATTRIBUTE_BYTES BYTEA NOT NULL,
                CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
                CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID)
                    REFERENCES SPRING_SESSION (PRIMARY_ID) ON DELETE CASCADE
            )
            """.trimIndent(),
        )
    }
}
