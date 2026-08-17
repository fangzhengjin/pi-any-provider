import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PI native refresh updates discovered providers and preserves cached models on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-provider-auto-refresh-"));
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "extension-settings"), { recursive: true });
  try {
    const script = `
      import { createHash } from "node:crypto"; import { readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path"; import { ModelRuntime } from "@earendil-works/pi-coding-agent";
      const agentDir=${JSON.stringify(agentDir)}; let fail=false, generation=1, requests=0; const notifications=[];
      const server=Bun.serve({port:0,fetch(request){requests++; if(fail)return new Response("down",{status:503});
        const path=new URL(request.url).pathname; return Response.json({data:path.startsWith("/one/")?[{id:generation===1?"new-one":"newer-one"},{id:"ignored-one"}]:[{id:"new-two"}]});}});
      const base=server.url.toString().replace(/\\/$/,"");
      const state={version:1,language:"en",providers:[
        {id:"AutoOne",name:"Auto One",rootUrl:base+"/one",modelSource:{type:"discover",modelIds:["old-one"],ignoredModelIds:["ignored-one"]},defaultApi:"anthropic-messages",protocolRules:[]},
        {id:"AutoTwo",name:"Auto Two",rootUrl:base+"/two",modelSource:{type:"discover",modelIds:["old-two"],ignoredModelIds:[]},defaultApi:"openai-responses",protocolRules:[{pattern:"old-two",api:"anthropic-messages"}]},]};
      const statePath=join(agentDir,"extension-settings/pi-custom-provider.json"), authPath=join(agentDir,"auth.json"), modelsPath=join(agentDir,"models.json");
      await writeFile(statePath,JSON.stringify(state,null,2)); await writeFile(authPath,JSON.stringify({AutoOne:{type:"api_key",key:"one-key"},AutoTwo:{type:"api_key",key:"two-key"}},null,2));
      const registrations=[], handlers={}; const {default:extension}=await import(${JSON.stringify(join(import.meta.dir, "../src/pi-custom-provider-extension.ts"))});
      await extension({registerProvider(id,config){registrations.push({id,config});},unregisterProvider(){},registerCommand(){},on(name,handler){handlers[name]=handler;}});
      await handlers.session_start?.({}, {model:{provider:"AutoOne",id:"old-one"},hasUI:true,ui:{notify(message,type){notifications.push({message,type});}}});
      const runtime=await ModelRuntime.create({authPath,modelsPath,modelsStorePath:join(agentDir,"models-store.json"),refreshOnCreate:false});
      for(const entry of registrations)runtime.registerProvider(entry.id,entry.config);
      await runtime.refresh({providers:["AutoOne","AutoTwo"],allowNetwork:false}); const offlineRequests=requests;
      const success=await runtime.refresh({providers:["AutoOne","AutoTwo"],allowNetwork:true,force:true});
      const firstRefreshed=JSON.parse(await readFile(statePath,"utf8")); generation=2;
      const repeated=await runtime.refresh({providers:["AutoOne","AutoTwo"],allowNetwork:true,force:true});
      const refreshed=JSON.parse(await readFile(statePath,"utf8")); const modelsAfterSuccess=await readFile(modelsPath,"utf8");
      const hash=(value)=>createHash("sha256").update(value).digest("hex"), beforeFailure=[hash(JSON.stringify(refreshed)),hash(modelsAfterSuccess)]; fail=true;
      const failed=await runtime.refresh({providers:["AutoOne","AutoTwo"],allowNetwork:true,force:true});
      const stateAfterFailure=JSON.parse(await readFile(statePath,"utf8")), modelsAfterFailure=await readFile(modelsPath,"utf8"); server.stop(true);
      process.stdout.write(JSON.stringify({offlineRequests,successErrors:success.errors.size,repeatedErrors:repeated.errors.size,failedErrors:failed.errors.size,firstRefreshed,refreshed,stateAfterFailure,notifications,
        runtimeOne:runtime.getModels("AutoOne").map(model=>model.id),runtimeTwo:runtime.getModels("AutoTwo").map(model=>model.id),
        profiles:[modelsAfterSuccess.includes('"newer-one"'),modelsAfterSuccess.includes('"new-two"')],beforeFailure,afterFailure:[hash(JSON.stringify(stateAfterFailure)),hash(modelsAfterFailure)]}));`;
    const result = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0); const output = JSON.parse(result.stdout.toString());
    expect(output).toMatchObject({ offlineRequests: 0, successErrors: 0, repeatedErrors: 0, failedErrors: 2, runtimeOne: ["newer-one", "old-one"], runtimeTwo: ["new-two"], profiles: [true, true] });
    expect(output.firstRefreshed.providers[0].modelSource).toEqual({ type: "discover", modelIds: ["new-one", "old-one"], ignoredModelIds: ["ignored-one"] });
    expect(output.notifications.map((entry: { message: string }) => entry.message).sort()).toEqual(["Auto One model list updated: 1 added, 0 removed", "Auto Two model list updated: 1 added, 1 removed"]);
    expect(output.notifications.every((entry: { type: string }) => entry.type === "info")).toBe(true);
    expect(output.refreshed.providers[0].modelSource.modelIds).toEqual(["newer-one", "old-one"]);
    expect(output.refreshed.providers[1]).toMatchObject({ modelSource: { modelIds: ["new-two"] }, protocolRules: [] });
    expect(output.stateAfterFailure).toEqual(output.refreshed); expect(output.afterFailure).toEqual(output.beforeFailure);
  } finally { await rm(root, { recursive: true, force: true }); }
});
