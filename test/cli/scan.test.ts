import { describe, expect, it } from "vitest";
import { isScanFailThreshold, shouldFailScan } from "../../src/cli/program.js";
import type { ScanResult } from "../../src/types.js";

const result = (
  verdict: ScanResult["reachability"]["verdict"],
): ScanResult => ({
  dependency: {
    name: "pkg",
    version: "1.0.0",
    lockfilePath: "node_modules/pkg",
    isDirect: true,
    dependencies: [],
  },
  advisory: {
    id: "GHSA-example",
    aliases: [],
    summary: "Example",
    details: "",
    affected: [],
  },
  reachability: {
    dependencyName: "pkg",
    verdict,
    reason: "fixture",
    evidence: [],
  },
});

describe("scan fail thresholds", () => {
  it.each(["reachable", "unknown", "any", "never"])(
    "accepts %s",
    (threshold) => {
      expect(isScanFailThreshold(threshold)).toBe(true);
    },
  );

  it("rejects unsupported thresholds", () => {
    expect(isScanFailThreshold("critical")).toBe(false);
  });

  it("fails by default only on reachable findings", () => {
    expect(shouldFailScan([result("REACHABLE")], "reachable")).toBe(true);
    expect(shouldFailScan([result("UNKNOWN")], "reachable")).toBe(false);
    expect(shouldFailScan([result("NOT_REACHABLE")], "reachable")).toBe(false);
  });

  it("provides stricter and non-failing thresholds", () => {
    expect(shouldFailScan([result("UNKNOWN")], "unknown")).toBe(true);
    expect(shouldFailScan([result("NOT_REACHABLE")], "any")).toBe(true);
    expect(shouldFailScan([result("REACHABLE")], "never")).toBe(false);
  });
});
