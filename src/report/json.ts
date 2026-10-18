import type { ScanResult } from "../types.js";

export interface JsonScanReport {
  schemaVersion: "1.0";
  tool: "reachfix";
  scannedAt: string;
  results: ScanResult[];
}

export function createJsonReport(
  results: ScanResult[],
  scannedAt: Date = new Date(),
): JsonScanReport {
  return {
    schemaVersion: "1.0",
    tool: "reachfix",
    scannedAt: scannedAt.toISOString(),
    results,
  };
}

export function renderJsonReport(report: JsonScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
