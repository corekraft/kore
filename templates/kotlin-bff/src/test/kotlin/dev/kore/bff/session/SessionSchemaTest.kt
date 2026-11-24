package dev.kore.bff.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.datasource.DriverManagerDataSource
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.sql.Connection
import java.sql.DatabaseMetaData
import java.sql.SQLException
import java.sql.Statement
import javax.sql.DataSource

// The session tables are created by one idempotent script run under a lock, so two
// replicas that start together neither fail on "already exists" nor race to create
// them. The ordering checks use a recording connection; the behaviour checks use H2;
// SessionSchemaPostgresTest runs the race against a real PostgreSQL when one is given.
class SessionSchemaTest {
    private fun h2(name: String) =
        DriverManagerDataSource("jdbc:h2:mem:$name;DB_CLOSE_DELAY=-1", "sa", "")

    private fun count(dataSource: DataSource, table: String): Int =
        dataSource.connection.use { c ->
            c.createStatement().use { s ->
                s.executeQuery("SELECT COUNT(*) FROM $table").use { it.next(); it.getInt(1) }
            }
        }

    @Test
    fun `creates the session and attribute tables`() {
        val dataSource = h2("schema-create")
        SessionSchema(dataSource).create()
        assertEquals(0, count(dataSource, "SPRING_SESSION"))
        assertEquals(0, count(dataSource, "SPRING_SESSION_ATTRIBUTES"))
    }

    @Test
    fun `running it again neither fails nor drops the sessions already stored`() {
        val dataSource = h2("schema-twice")
        SessionSchema(dataSource).create()
        dataSource.connection.use { c ->
            c.createStatement().use {
                it.executeUpdate(
                    "INSERT INTO SPRING_SESSION VALUES ('p1','s1',1,1,1800,2000,'user')",
                )
            }
        }
        SessionSchema(dataSource).create()
        assertEquals(1, count(dataSource, "SPRING_SESSION"))
    }

    @Test
    fun `defines every table and index of the Spring Session PostgreSQL schema it is a copy of`() {
        val upstream = ClassPathResource("org/springframework/session/jdbc/schema-postgresql.sql")
            .inputStream.bufferedReader().readText()
        val names = Regex("""CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\w+)""", RegexOption.IGNORE_CASE)
            .findAll(upstream).map { it.groupValues[1] }.toList()
        assertTrue(names.size >= 5, names.toString())
        val ours = SessionSchema.STATEMENTS.joinToString("\n")
        names.forEach { assertTrue(ours.contains(it), "the schema script does not define $it") }
        val columns = Regex("""^\s+(\w+)\s+(?:CHAR|BIGINT|INT|VARCHAR|BYTEA)""", setOf(RegexOption.MULTILINE))
            .findAll(upstream).map { it.groupValues[1] }.toSet()
        columns.forEach { assertTrue(ours.contains(it), "the schema script has no column $it") }
    }

    @Test
    fun `every statement is idempotent`() {
        SessionSchema.STATEMENTS.forEach {
            assertTrue(it.contains("IF NOT EXISTS", ignoreCase = true), it)
        }
    }

    private class Recorder {
        val calls = mutableListOf<String>()
        var failOn: String? = null

        fun connection(product: String): DataSource {
            val statement = proxy<Statement> { method, args ->
                if (method.name == "execute") {
                    val sql = args!![0] as String
                    calls += "execute:${sql.trim().lineSequence().first().take(48)}"
                    if (failOn != null && sql.contains(failOn!!)) throw SQLException("boom")
                    false
                } else {
                    null
                }
            }
            val metaData = proxy<DatabaseMetaData> { method, _ ->
                if (method.name == "getDatabaseProductName") product else null
            }
            val connection = proxy<Connection> { method, args ->
                when (method.name) {
                    "createStatement" -> statement
                    "getMetaData" -> metaData
                    "getAutoCommit" -> true
                    "setAutoCommit" -> { calls += "autocommit:${args!![0]}"; null }
                    "commit" -> { calls += "commit"; null }
                    "rollback" -> { calls += "rollback"; null }
                    "close" -> { calls += "close"; null }
                    else -> null
                }
            }
            return proxy<DataSource> { method, _ ->
                if (method.name == "getConnection") connection else null
            }
        }

        private inline fun <reified T> proxy(crossinline handler: (java.lang.reflect.Method, Array<out Any?>?) -> Any?): T {
            val invocation = InvocationHandler { _, method, args -> handler(method, args) }
            return Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java), invocation) as T
        }
    }

    @Test
    fun `on PostgreSQL one transaction takes an advisory lock first, then creates, then commits`() {
        val recorder = Recorder()
        SessionSchema(recorder.connection("PostgreSQL")).create()
        val calls = recorder.calls
        assertEquals("autocommit:false", calls.first())
        assertTrue(calls[1].startsWith("execute:SELECT pg_advisory_xact_lock"), calls.toString())
        assertTrue(calls.drop(2).take(SessionSchema.STATEMENTS.size).all { it.startsWith("execute:CREATE") }, calls.toString())
        assertEquals("commit", calls[2 + SessionSchema.STATEMENTS.size])
        assertFalse(calls.contains("rollback"))
    }

    @Test
    fun `a failed statement rolls the transaction back and surfaces the failure`() {
        val recorder = Recorder().apply { failOn = "SPRING_SESSION_ATTRIBUTES" }
        val error = assertThrows(IllegalStateException::class.java) {
            SessionSchema(recorder.connection("PostgreSQL")).create()
        }
        assertTrue(error.message!!.contains("session tables"), error.message)
        assertTrue(recorder.calls.contains("rollback"), recorder.calls.toString())
        assertFalse(recorder.calls.contains("commit"))
    }

    @Test
    fun `a database that is not PostgreSQL takes no advisory lock`() {
        val recorder = Recorder()
        SessionSchema(recorder.connection("H2")).create()
        assertFalse(recorder.calls.any { it.contains("advisory") }, recorder.calls.toString())
    }
}
