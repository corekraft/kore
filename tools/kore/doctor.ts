import { totalmem, cpus } from "node:os";
import { statfs } from "node:fs/promises";
import type { Repository } from "./config.js";
import type { Runner } from "./runner.js";

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check { name: string; status: CheckStatus; message: string; required: boolean }

const commands: Record<string, readonly string[]> = {
  node: ["--version"], npm: ["--version"], minikube: ["version", "--short"],
  kubectl: ["version", "--client=true", "-o", "json"], helm: ["version", "--short"],
  yq: ["--version"], sops: ["--version"], age: ["--version"], mkcert: ["--version"],
  tofu: ["version"], opa: ["version"], docker: ["--version"],
};
const required = new Set(["node", "npm", "minikube", "kubectl", "helm", "docker"]);

function detectedVersion(output: string): string | undefined {
  return output.match(/v?(\d+\.\d+\.\d+)/)?.[1];
}
function majorMinor(value: string): string { return value.replace(/^v/, "").split(".").slice(0, 2).join("."); }

export async function doctor(repository: Repository, runner: Runner): Promise<Check[]> {
  const checks: Check[] = [];
  for (const [tool, expected] of Object.entries(repository.versions.tools)) {
    const args = commands[tool];
    if (!args) continue;
    try {
      const result = await runner.run(tool, args, { capture: true });
      const actual = detectedVersion(`${result.stdout}\n${result.stderr}`);
      const matches = actual && majorMinor(actual) === majorMinor(expected);
      checks.push({ name: `tool:${tool}`, status: matches ? "pass" : (required.has(tool) ? "fail" : "warn"), required: required.has(tool), message: matches ? `${actual} (pinned ${expected})` : `found ${actual ?? "unknown"}, expected ${expected}` });
    } catch (error) {
      checks.push({ name: `tool:${tool}`, status: required.has(tool) ? "fail" : "warn", required: required.has(tool), message: `not available: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  try { await runner.run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true }); checks.push({ name:"container-runtime",status:"pass",required:true,message:"Docker daemon is reachable" }); }
  catch (error) { checks.push({ name:"container-runtime",status:"fail",required:true,message:`Docker daemon is unavailable: ${error instanceof Error ? error.message : String(error)}` }); }
  const cpuCount = cpus().length;
  checks.push({ name:"host:cpu", status:cpuCount >= repository.environment.cluster.cpus ? "pass":"fail", required:true, message:`${cpuCount} available, ${repository.environment.cluster.cpus} required` });
  const memoryMB = Math.floor(totalmem() / 1024 / 1024);
  checks.push({ name:"host:memory", status:memoryMB >= repository.environment.cluster.memoryMB ? "pass":"fail", required:true, message:`${memoryMB} MiB available, ${repository.environment.cluster.memoryMB} MiB required` });
  const fs = await statfs(repository.root); const freeGB = Math.floor(Number(fs.bavail * fs.bsize) / 1024 ** 3); const requestedGB = Number.parseInt(repository.environment.cluster.diskSize, 10);
  checks.push({ name:"host:disk", status:freeGB >= requestedGB ? "pass":"fail", required:true, message:`${freeGB} GiB free, ${requestedGB} GiB required` });
  if (repository.environment.provider === "managed") {
    checks.push({ name:"credentials", status:repository.environment.kubeContext === "REQUIRED" ? "fail":"pass", required:true, message:repository.environment.kubeContext === "REQUIRED" ? "managed environment credentials/context are not configured":"managed context is configured" });
  } else checks.push({ name:"credentials",status:"pass",required:false,message:"local environment needs no cloud credentials" });
  try {
    const result = await runner.run("minikube", ["profile", "list", "-o", "json"], { capture:true });
    const profiles = JSON.parse(result.stdout) as { valid?: { Name?: string; Config?: { Name?: string } }[] };
    const conflicting = (profiles.valid ?? []).filter((profile) => (profile.Name ?? profile.Config?.Name) === repository.environment.cluster.profile);
    checks.push({ name:"minikube-profile",status:conflicting.length <= 1 ? "pass":"fail",required:true,message:conflicting.length <= 1 ? "profile name is unambiguous":"multiple matching profiles found" });
  } catch { checks.push({ name:"minikube-profile",status:"warn",required:false,message:"profile list unavailable; no running profile may exist" }); }
  return checks;
}

export function doctorFailed(checks: Check[]): boolean { return checks.some((check) => check.required && check.status === "fail"); }
