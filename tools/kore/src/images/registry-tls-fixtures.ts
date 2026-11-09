export const registryCaPem =
  "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";

/** What `kubectl get secret oci-registry-tls -o json` answers once issued. */
export const registryTlsSecret = JSON.stringify({
  data: { "ca.crt": Buffer.from(registryCaPem).toString("base64") },
});
