package dev.kore.bff.session

import com.zaxxer.hikari.HikariDataSource
import dev.kore.bff.signin.SigninEnabledCondition
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Conditional
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import javax.sql.DataSource

/**
 * The shared session store, present only while golden-path-signin is on. Boot's
 * own DataSource auto-configuration is excluded in application.yaml, so with
 * sign-in off there is no database, no connection and no JDBC session: the
 * AOT training run and the verify run refresh the context with none reachable.
 * With it on this DataSource is the one bean Spring Boot's Spring Session JDBC
 * configuration builds on, and the pool connects only when first used.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(SigninEnabledCondition::class)
class SessionStoreConfiguration {
    @Bean
    fun sessionStoreSettings(environment: Environment): SessionStoreSettings =
        SessionStoreSettings.from { environment.getProperty(it) }

    @Bean(destroyMethod = "close")
    fun dataSource(settings: SessionStoreSettings): DataSource =
        HikariDataSource().apply {
            poolName = "session-store"
            jdbcUrl = settings.url
            username = settings.username
            password = settings.password()
            // Each replica holds a handful of connections: a session is read and
            // written once per request, and the claimed database is small.
            maximumPoolSize = 5
        }

    @Bean
    fun sessionSchema(dataSource: DataSource): SessionSchema = SessionSchema(dataSource)
}
