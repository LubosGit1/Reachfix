import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicFixClient } from "../../src/fix/anthropic-client.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const modelInput = {
  unifiedDiff: [
    "diff --git a/src.ts b/src.ts",
    "--- a/src.ts",
    "+++ b/src.ts",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
  ].join("\n"),
  changedFiles: ["src.ts"],
  rationale: "Use the updated API.",
};

function apiResponse(input: unknown) {
  return new Response(
    JSON.stringify({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "fixture-model",
      content: [
        {
          type: "tool_use",
          id: "toolu_fixture",
          name: "submit_reachfix_patch",
          input,
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 80 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Anthropic fix client", () => {
  it("requests a structured tool response and validates it with Zod", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return apiResponse(modelInput);
      },
    );
    vi.stubEnv("ANTHROPIC_API_KEY", "test-fixture-key");
    const client = new AnthropicFixClient({
      model: "fixture-model",
      fetch,
      maxTokens: 128,
    });

    const result = await client.generateFix({
      advisory: { id: "GHSA-test", summary: "test", details: "details" },
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      releaseNotes: "",
      typeDefinitions: "",
      files: [{ path: "src.ts", content: "source", callSiteLines: [1] }],
    });

    expect(result.input).toEqual(modelInput);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
    expect(requestBody?.tool_choice).toEqual({
      type: "tool",
      name: "submit_reachfix_patch",
    });
    expect(requestBody?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "submit_reachfix_patch",
          strict: true,
          input_schema: expect.objectContaining({
            additionalProperties: false,
          }),
        }),
      ]),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns malformed tool input for the Zod-validated repair boundary", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-fixture-key");
    const client = new AnthropicFixClient({
      model: "fixture-model",
      fetch: vi.fn(async () => apiResponse({ unifiedDiff: "bad" })),
      maxTokens: 128,
    });

    const result = await client.generateFix({
      advisory: { id: "GHSA-test", summary: "test", details: "details" },
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      releaseNotes: "",
      typeDefinitions: "",
      files: [],
    });

    expect(result.input).toEqual({ unifiedDiff: "bad" });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  it("requires credentials from the environment", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(() => new AnthropicFixClient()).toThrow(
      "ANTHROPIC_API_KEY is required for LLM-assisted fixes.",
    );
  });
});
