import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OsvAdvisoryClient } from "../../src/advisories/osv-client.js";
import type { DependencyNode } from "../../src/types.js";
import { parseLockfile } from "../../src/inventory/lockfile-parser.js";
import { fileURLToPath } from "node:url";

const fixturesPath = fileURLToPath(new URL("../fixtures/", import.meta.url));
const advisoryResponse = {
  id: "GHSA-test-1234",
  aliases: ["OSV-TEST-1234"],
  summary: "Test advisory",
  details: "A fixture advisory used to verify version matching.",
  affected: [
    {
      package: { ecosystem: "npm", name: "vulnerable" },
      ranges: [
        { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.3.0" }] },
      ],
      versions: [],
    },
  ],
};

let temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories = [];
});

async function createCacheDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "reachfix-osv-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "cache");
}

function responseForQueries(queryCount: number): Response {
  return new Response(
    JSON.stringify({
      results: Array.from({ length: queryCount }, () => ({
        vulns: [advisoryResponse],
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OSV advisory client", () => {
  it.each(["npm-v2", "npm-v3", "pnpm-v9"])(
    "finds the vulnerable package in the %s fixture",
    async (fixture) => {
      const inventory = await parseLockfile(path.join(fixturesPath, fixture));
      const fetch = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as { queries: unknown[] };
          return responseForQueries(body.queries.length);
        },
      );
      const client = new OsvAdvisoryClient({
        cacheDirectory: await createCacheDirectory(),
        fetch,
      });

      const findings = await client.findVulnerabilities(inventory.dependencies);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.dependency).toMatchObject({
        name: "vulnerable",
        isDirect: fixture === "npm-v3",
      });
      expect(findings[0]?.advisories.map(({ id }) => id)).toEqual([
        "GHSA-test-1234",
      ]);
    },
  );

  it("caches both advisory results and empty results for 24 hours", async () => {
    const cacheDirectory = await createCacheDirectory();
    const fetch = vi.fn(async () => responseForQueries(1));
    const dependency: DependencyNode = {
      name: "vulnerable",
      version: "2.0.0",
      lockfilePath: "node_modules/vulnerable",
      isDirect: true,
      dependencies: [],
    };
    const client = new OsvAdvisoryClient({ cacheDirectory, fetch });

    await client.findVulnerabilities([dependency]);
    await client.findVulnerabilities([dependency]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes expired cache entries", async () => {
    const cacheDirectory = await createCacheDirectory();
    const fetch = vi.fn(async () => responseForQueries(1));
    const dependency: DependencyNode = {
      name: "vulnerable",
      version: "2.0.0",
      lockfilePath: "node_modules/vulnerable",
      isDirect: true,
      dependencies: [],
    };
    let now = 1000;
    const client = new OsvAdvisoryClient({
      cacheDirectory,
      fetch,
      now: () => now,
      ttlMs: 100,
    });

    await client.findVulnerabilities([dependency]);
    now += 100;
    await client.findVulnerabilities([dependency]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not report versions outside the affected semver range", async () => {
    const client = new OsvAdvisoryClient({
      cacheDirectory: await createCacheDirectory(),
      fetch: vi.fn(async () => responseForQueries(1)),
    });
    const dependency: DependencyNode = {
      name: "vulnerable",
      version: "2.3.0",
      lockfilePath: "node_modules/vulnerable",
      isDirect: true,
      dependencies: [],
    };

    await expect(client.findVulnerabilities([dependency])).resolves.toEqual([]);
  });

  it("surfaces OSV HTTP failures", async () => {
    const client = new OsvAdvisoryClient({
      cacheDirectory: await createCacheDirectory(),
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
    });
    const dependency: DependencyNode = {
      name: "vulnerable",
      version: "2.0.0",
      lockfilePath: "node_modules/vulnerable",
      isDirect: true,
      dependencies: [],
    };

    await expect(
      client.findVulnerabilities([dependency]),
    ).rejects.toMatchObject({
      name: "OsvClientError",
      code: "REQUEST_FAILED",
    });
  });
});
