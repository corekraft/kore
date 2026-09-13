import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "./config.js";
import type { RunOptions, RunResult, Runner } from "./runner.js";
import { syncLocalSecrets } from "./secrets.js";

class SecretRunner implements Runner {
  calls:{command:string,args:readonly string[],options?:RunOptions}[]=[];
  async run(command:string,args:readonly string[],options?:RunOptions):Promise<RunResult>{
    this.calls.push({command,args,...(options?{options}:{})});
    if(command==="sops")return{stdout:"apiVersion: v1\nkind: Secret\nmetadata:\n  name: source\n",stderr:"",code:0};
    if(command==="kubectl"&&args.includes("jsonpath={.metadata.name}"))return{stdout:"kube-system",stderr:"",code:0};
    return{stdout:"",stderr:"",code:0};
  }
}

test("secret sync streams plaintext only through kubectl stdin",async()=>{
  const repository=await loadRepository("local"); const directory=join(repository.root,"infra/environments/local/secrets"); const fixture=join(directory,"test.enc.yaml");
  await mkdir(directory,{recursive:true}); await writeFile(fixture,"sops: encrypted");
  const runner=new SecretRunner();
  try{await syncLocalSecrets(repository,runner);}
  finally{const{rm}=await import("node:fs/promises");await rm(fixture,{force:true});}
  const apply=runner.calls.find(({command,args})=>command==="kubectl"&&args.includes("-")&&args.includes("kore-secret-source"));
  assert.match(apply?.options?.input??"",/kind: Secret/);
  assert.equal(apply?.args.includes("kore-local"),true);
  assert.equal(apply?.args.includes("kore-secret-source"),true);
});
