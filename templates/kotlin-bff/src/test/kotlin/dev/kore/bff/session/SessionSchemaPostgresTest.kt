package dev.kore.bff.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors

// Opt in with SESSION_SCHEMA_POSTGRES_URL (a jdbc:postgresql URL whose database is
// empty and whose user may create tables), SESSION_SCHEMA_POSTGRES_USER and
// SESSION_SCHEMA_POSTGRES_PASSWORD. CI sets none, so it is skipped there.
@EnabledIfEnvironmentVariable(named = "SESSION_SCHEMA_POSTGRES_URL", matches = ".+")
class SessionSchemaPostgresTest {
    @Test
    fun `replicas that all start at the same moment on PostgreSQL each create the tables without an error`() {
        val dataSource = DriverManagerDataSource(
            System.getenv("SESSION_SCHEMA_POSTGRES_URL"),
            System.getenv("SESSION_SCHEMA_POSTGRES_USER"),
            System.getenv("SESSION_SCHEMA_POSTGRES_PASSWORD"),
        )
        val replicas = 8
        val barrier = CyclicBarrier(replicas)
        val pool = Executors.newFixedThreadPool(replicas)
        try {
            val runs = (1..replicas).map {
                pool.submit(Callable { barrier.await(); SessionSchema(dataSource).create() })
            }
            runs.forEach { it.get() }
        } finally {
            pool.shutdownNow()
        }
        val tables = dataSource.connection.use { c ->
            c.createStatement().use { s ->
                s.executeQuery(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('spring_session', 'spring_session_attributes')",
                ).use { it.next(); it.getInt(1) }
            }
        }
        assertEquals(2, tables)
    }
}
