import { describe, expect, it } from "vitest";
import { parseBenchmarkCase } from "../../src/bench/case-schema.js";

describe("benchmark case schema", () => {
  it("accepts a pinned public GitHub case with a manual rationale", () => {
    expect(
      parseBenchmarkCase({
        id: "case-1",
        repository: "https://github.com/owner/repository",
        commit: "a".repeat(40),
        advisoryId: "GHSA-example",
        expectedVerdict: "UNKNOWN",
        rationale: "Insufficient evidence to establish reachability.",
      }).expectedVerdict,
    ).toBe("UNKNOWN");
  });

  it.each([
    "http://github.com/owner/repository",
    "https://example.com/owner/repository",
    "https://user:password@github.com/owner/repository",
  ])("rejects an unsafe repository URL: %s", (repository) => {
    expect(() =>
      parseBenchmarkCase({
        id: "case-1",
        repository,
        commit: "a".repeat(40),
        advisoryId: "GHSA-example",
        expectedVerdict: "REACHABLE",
        rationale: "Manually verified.",
      }),
    ).toThrow();
  });
});
