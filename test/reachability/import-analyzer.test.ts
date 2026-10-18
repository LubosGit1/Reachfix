import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ImportReachabilityAnalyzer } from "../../src/reachability/import-analyzer.js";

const fixturesPath = fileURLToPath(
  new URL("../fixtures/reachability/", import.meta.url),
);

describe("import reachability analyzer", () => {
  it("marks direct ESM imports as reachable", async () => {
    const result = await new ImportReachabilityAnalyzer().analyze(
      path.join(fixturesPath, "esm"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(result.evidence).toHaveLength(1);
  });

  it("marks CommonJS require calls as reachable", async () => {
    const result = await new ImportReachabilityAnalyzer().analyze(
      path.join(fixturesPath, "cjs"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(result.evidence[0]?.importType).toBe("require");
  });

  it("marks re-exports as reachable", async () => {
    const result = await new ImportReachabilityAnalyzer().analyze(
      path.join(fixturesPath, "reexport"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(result.evidence[0]?.importType).toBe("export");
  });

  it("marks dynamic variable-based requires as unknown", async () => {
    const result = await new ImportReachabilityAnalyzer().analyze(
      path.join(fixturesPath, "dynamic"),
      "vulnerable",
    );

    expect(result.verdict).toBe("UNKNOWN");
    expect(result.evidence[0]?.statement).toContain("require(target)");
  });

  it("marks absence of import as not reachable", async () => {
    const result = await new ImportReachabilityAnalyzer().analyze(
      path.join(fixturesPath, "dead"),
      "vulnerable",
    );

    expect(result.verdict).toBe("NOT_REACHABLE");
    expect(result.evidence).toHaveLength(0);
  });
});
