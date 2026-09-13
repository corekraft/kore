import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repository } from "./config.js";
import { assertExpectedCluster } from "./cluster.js";
import type { Runner } from "./runner.js";

export function issuerManifest(name:string,secretName:string):string{return `apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: ${name}\nspec:\n  ca:\n    secretName: ${secretName}\n`;}

export async function installLocalTrust(repository:Repository,runner:Runner):Promise<void>{
  if(repository.environment.provider!=="minikube")throw new Error("local CA trust is only valid for a Minikube environment");
  await assertExpectedCluster(repository,runner);
  const namespace=repository.environment.gateway.namespace, certificateNamespace="cert-manager";
  for (const targetNamespace of new Set([namespace, certificateNamespace])) {
    const ownership = targetNamespace === namespace ? "  labels:\n    app.kubernetes.io/managed-by: Helm\n  annotations:\n    meta.helm.sh/release-name: kore-platform-config\n    meta.helm.sh/release-namespace: kore-system\n" : "";
    const namespaceManifest=`apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${targetNamespace}\n${ownership}`;
    await runner.run("kubectl",["--context",repository.environment.kubeContext,"apply","--server-side","--field-manager=kore-trust","--filename","-"],{capture:true,input:namespaceManifest});
  }
  await runner.run("mkcert",["-install"],{capture:false});
  const rootResult=await runner.run("mkcert",["-CAROOT"],{capture:true}); const caRoot=rootResult.stdout.trim();
  if(!caRoot)throw new Error("mkcert did not return its CA root");
  const cert=join(caRoot,"rootCA.pem"),key=join(caRoot,"rootCA-key.pem");
  const secret="kore-local-ca-key-pair";
  const secretYaml=(await runner.run("kubectl",["--context",repository.environment.kubeContext,"--namespace",certificateNamespace,"create","secret","tls",secret,"--cert",cert,"--key",key,"--dry-run=client","--output","yaml"],{capture:true})).stdout;
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"apply","--server-side","--field-manager=kore-trust","--filename","-"],{capture:true,input:secretYaml});
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"apply","--server-side","--field-manager=kore-trust","--filename","-"],{capture:true,input:issuerManifest("kore-local-ca",secret)});
  // Ensure this operation never leaves a copied CA in the repository or a build artifact.
  await Promise.allSettled([readFile(cert),readFile(key)]);
}

export async function removeLocalTrustArtifacts(repository:Repository):Promise<void>{await rm(join(tmpdir(),`kore-ca-${repository.environment.name}`),{recursive:true,force:true});}
