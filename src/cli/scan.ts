import { OsvAdvisoryClient } from "../advisories/osv-client.js";
import { parseLockfile } from "../inventory/lockfile-parser.js";
import type { LockfileParser } from "../inventory/lockfile-parser.js";
import type { AdvisoryFinding } from "../types.js";

export interface ScanServices {
  advisoryClient?: OsvAdvisoryClient;
  lockfileParser?: LockfileParser;
}

export async function scanProject(
  projectPath: string,
  services: ScanServices = {},
): Promise<AdvisoryFinding[]> {
  const inventory = services.lockfileParser
    ? await services.lockfileParser.parse(projectPath)
    : await parseLockfile(projectPath);
  return (
    services.advisoryClient ?? new OsvAdvisoryClient()
  ).findVulnerabilities(inventory.dependencies);
}
