import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "./config.js";
import { assertExpectedCluster } from "./cluster.js";
import type { Runner } from "./runner.js";

export async function syncLocalSecrets(repository:Repository,runner:Runner):Promise<number>{
  if(repository.environment.provider!=="minikube")throw new Error("local SOPS synchronization is only valid for a Minikube environment");
  await assertExpectedCluster(repository,runner);
  const context=repository.environment.kubeContext,namespace=repository.environment.secrets.sourceNamespace;
  const namespaceManifest=`apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    platform.kore.dev/secret-source: \"true\"\n`;
  await runner.run("kubectl",["--context",context,"apply","--server-side","--field-manager=kore-secrets","--filename","-"],{capture:true,input:namespaceManifest});
  const directory=join(repository.root,"infra/environments",repository.environment.name,"secrets");
  const files=(await readdir(directory)).filter((file)=>file.endsWith(".enc.yaml")).sort();
  for(const file of files){
    const decrypted=await runner.run("sops",["--decrypt",join(directory,file)],{capture:true});
    await runner.run("kubectl",["--context",context,"--namespace",namespace,"apply","--server-side","--field-manager=kore-secrets","--filename","-"],{capture:true,input:decrypted.stdout});
  }
  return files.length;
}

