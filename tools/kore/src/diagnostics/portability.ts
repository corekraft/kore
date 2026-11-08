import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";

export interface PortabilityReport {
  environment: string;
  applications: string[];
}

const providerSpecific = /\b(?:minikube|eks|gke|aks|azure|aws|gcp)\b/i;
const environmentOverlay =
  /(?:infra\/environments\/|values\/local|local\.ya?ml)/i;

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

export async function validatePortability(
  repository: Repository,
): Promise<PortabilityReport> {
  const appsDirectory = join(repository.root, "apps");
  let applications: string[];
  try {
    applications = (await readdir(appsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error("portability validation requires an apps directory");
  }
  if (!applications.length) {
    throw new Error("portability validation found no applications");
  }

  for (const application of applications) {
    for (const chart of ["resources", "workload"]) {
      const chartDirectory = join(appsDirectory, application, "charts", chart);
      try {
        await readFile(join(chartDirectory, "Chart.yaml"), "utf8");
      } catch {
        throw new Error(`${application}: missing ${chart} chart`);
      }
      for (const path of await filesIn(chartDirectory)) {
        const contents = await readFile(path, "utf8");
        const providerMatch = contents.match(providerSpecific);
        if (providerMatch) {
          throw new Error(
            `${application}: provider-specific reference ${providerMatch[0]} in ${path}`,
          );
        }
        const overlayMatch = contents.match(environmentOverlay);
        if (overlayMatch) {
          throw new Error(
            `${application}: environment overlay reference ${overlayMatch[0]} in ${path}`,
          );
        }
      }
    }
  }
  return { environment: repository.environment.name, applications };
}
