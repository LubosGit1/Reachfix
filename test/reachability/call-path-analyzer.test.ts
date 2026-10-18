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
    expect(result.reason).toContain("no supported calls");
  });

  it("supports namespace imports and member calls", async () => {
    const result = await new CallPathAnalyzer().analyze(
      path.join(fixturesPath, "namespace-sym"),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(
      result.evidence.some((entry) => entry.statement === "vulnerable.run()"),
    ).toBe(true);
  });

  it.each([
    ["named-sym", "mergeValues() imports merge"],
    ["destructured-sym", "mergeValues() imports merge"],
    ["default-import-sym", "vulnerable.merge()"],
    ["commonjs-alias-sym", "lodash.merge()"],
  ])("reports the called symbol and line for %s", async (fixture, symbol) => {
    const result = await new CallPathAnalyzer().analyze(
      path.join(fixturesPath, fixture),
      "vulnerable",
    );

    expect(result.verdict).toBe("REACHABLE");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ line: 3, statement: symbol }),
    );
  });
});
