import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CallPathAnalyzer } from "../../src/reachability/call-path-analyzer.js";

const fixturesPath = fileURLToPath(
  new URL("../fixtures/reachability/", import.meta.url),
);

describe("call path analyzer", () => {
  it("flags imported symbols that are invoked", async () => {
    const result = await new CallPathAnalyzer().analyze(
      path.join(fixturesPath, "used-sym"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(result.reason).toContain("invoked");
  });

  it("flags imported-but-unused symbols as not reachable", async () => {
    const result = await new CallPathAnalyzer().analyze(
      path.join(fixturesPath, "unused-sym"),
      "vulnerable",
    );

    expect(result.verdict).toBe("NOT_REACHABLE");
    expect(result.reason).toContain("not called");
  });

  it("supports namespace imports and member calls", async () => {
    const result = await new CallPathAnalyzer().analyze(
      path.join(fixturesPath, "namespace-sym"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(
      result.evidence.some((entry) =>
        entry.statement.includes("namespace-call"),
      ),
    ).toBe(true);
  });
});
