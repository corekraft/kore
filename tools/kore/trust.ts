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
  await runner.run("mkcert",["-install"],{capture:false});
  const rootResult=await runner.run("mkcert",["-CAROOT"],{capture:true}); const caRoot=rootResult.stdout.trim();
  if(!caRoot)throw new Error("mkcert did not return its CA root");
  const cert=join(caRoot,"rootCA.pem"),key=join(caRoot,"rootCA-key.pem");
  const namespace=repository.environment.gateway.namespace,secret="kore-local-ca-key-pair";
  const secretYaml=(await runner.run("kubectl",["--context",repository.environment.kubeContext,"--namespace",namespace,"create","secret","tls",secret,"--cert",cert,"--key",key,"--dry-run=client","--output","yaml"],{capture:true})).stdout;
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"apply","--server-side","--field-manager=kore-trust","--filename","-"],{capture:true,input:secretYaml});
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"apply","--server-side","--field-manager=kore-trust","--filename","-"],{capture:true,input:issuerManifest(repository.environment.gateway.name,secret)});
  // Ensure this operation never leaves a copied CA in the repository or a build artifact.
  await Promise.allSettled([readFile(cert),readFile(key)]);
}

export async function removeLocalTrustArtifacts(repository:Repository):Promise<void>{await rm(join(tmpdir(),`kore-ca-${repository.environment.name}`),{recursive:true,force:true});}

