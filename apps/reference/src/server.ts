import { createServer } from "node:http";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";

const mode = process.env.APP_MODE ?? "api";
const port = Number(process.env.PORT ?? "8080");
const api = process.env.API_URL ?? "http://reference-api:8080";
const service = process.env.OTEL_SERVICE_NAME ?? `reference-${mode}`;
const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

async function telemetry(path: string, status: number, durationMs: number, traceId: string): Promise<void> {
  const attributes = [{key:"service.name",value:{stringValue:service}},{key:"http.route",value:{stringValue:path}},{key:"http.response.status_code",value:{intValue:String(status)}}];
  console.log(JSON.stringify({severity:"INFO",message:"request",service,path,status,durationMs,traceId}));
  if (!otlp) return;
  const now = String(BigInt(Date.now()) * 1_000_000n);
  await Promise.allSettled([
    fetch(`${otlp}/v1/traces`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceSpans:[{resource:{attributes},scopeSpans:[{scope:{name:"kore.reference"},spans:[{traceId:traceId.padEnd(32,"0").slice(0,32),spanId:traceId.slice(0,16),name:`${mode} ${path}`,kind:2,startTimeUnixNano:now,endTimeUnixNano:String(BigInt(now)+BigInt(durationMs)*1_000_000n),status:{code:status<400?1:2},attributes}]}]}]})}),
    fetch(`${otlp}/v1/logs`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceLogs:[{resource:{attributes},scopeLogs:[{scope:{name:"kore.reference"},logRecords:[{timeUnixNano:now,severityText:"INFO",body:{stringValue:"request complete"},traceId:traceId.padEnd(32,"0").slice(0,32),attributes}]}]}]})}),
    fetch(`${otlp}/v1/metrics`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceMetrics:[{resource:{attributes},scopeMetrics:[{scope:{name:"kore.reference"},metrics:[{name:"http.server.request.count",unit:"{request}",sum:{aggregationTemporality:1,isMonotonic:true,dataPoints:[{asInt:"1",timeUnixNano:now,attributes}]}}]}]}]})}),
  ]);
}

function databaseReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({host:process.env.PGHOST ?? "reference-db-rw",port:Number(process.env.PGPORT ?? "5432")});
    const done = (value:boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000); socket.once("connect",()=>done(true)); socket.once("error",()=>done(false)); socket.once("timeout",()=>done(false));
  });
}

createServer(async (request,response) => {
  const start = Date.now(), path = request.url ?? "/", traceId = (request.headers.traceparent?.split("-")[1] ?? randomUUID().replaceAll("-",""));
  let status = 200, body:unknown;
  try {
    if (path === "/livez") body = {live:true};
    else if (path === "/readyz") { const ready = mode === "frontend" || await databaseReady(); status = ready ? 200 : 503; body = {ready}; }
    else if (mode === "frontend") {
      const apiToken = process.env.API_TOKEN;
      const role = apiToken && request.headers.authorization === `Bearer ${apiToken}` ? "developer" : "viewer";
      const upstream = await fetch(`${api}${path}`,{headers:{traceparent:`00-${traceId.padEnd(32,"0").slice(0,32)}-${traceId.slice(0,16)}-01`,"x-kore-authenticated-role":role}});
      status=upstream.status;
      const upstreamBody=await upstream.text();
      if (!upstreamBody) body={error:status>=400?"upstream request denied":"empty upstream response"};
      else {
        try { body=JSON.parse(upstreamBody); }
        catch { body={error:upstreamBody}; }
      }
    } else if (path === "/api" || path === "/api/protected") body={service,authenticatedPrincipal:request.headers["x-forwarded-client-cert"]??"mesh",database:await databaseReady()};
    else { status=404; body={error:"not found"}; }
  } catch (error) { status=502; body={error:error instanceof Error?error.message:String(error)}; }
  response.writeHead(status,{"content-type":"application/json"}); response.end(JSON.stringify(body));
  await telemetry(path,status,Date.now()-start,traceId);
}).listen(port,"0.0.0.0");
