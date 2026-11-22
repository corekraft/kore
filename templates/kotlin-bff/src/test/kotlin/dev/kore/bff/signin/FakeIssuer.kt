package dev.kore.bff.signin

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.Executors

// A loopback OIDC discovery document, so the sign-in flow starts without the
// network. Test only.
internal object FakeIssuer {
    private val server: HttpServer =
        HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
            createContext("/.well-known/openid-configuration") { respond(it, discovery()) }
            createContext("/jwks") { respond(it, """{"keys":[]}""") }
            executor = Executors.newSingleThreadExecutor { Thread(it).apply { isDaemon = true } }
            start()
        }

    val uri: String = "http://127.0.0.1:${server.address.port}"

    private fun discovery(): String =
        """{"issuer":"$uri","authorization_endpoint":"$uri/authorize","token_endpoint":"$uri/token",""" +
            """"jwks_uri":"$uri/jwks","response_types_supported":["code"],"subject_types_supported":["public"],""" +
            """"id_token_signing_alg_values_supported":["RS256"]}"""

    private fun respond(exchange: HttpExchange, body: String) {
        val bytes = body.toByteArray()
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }
}
