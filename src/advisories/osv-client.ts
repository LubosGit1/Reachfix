import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import semver from "semver";
import { OsvClientError } from "./errors.js";
import type {
  Advisory,
  AdvisoryAffectedPackage,
  AdvisoryEvent,
  AdvisoryFinding,
  AdvisoryRange,
  DependencyNode,
} from "../types.js";

const DEFAULT_ENDPOINT = "https://api.osv.dev/v1/querybatch";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 1000;

export interface OsvClientOptions {
  cacheDirectory?: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  ttlMs?: number;
  batchSize?: number;
}

interface OsvQuery {
  name: string;
  version: string;
}

interface CachedAdvisories {
  cachedAt: number;
  advisories: Advisory[];
}

export class OsvAdvisoryClient {
  private readonly cacheDirectory: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly batchSize: number;

  constructor(options: OsvClientOptions = {}) {
    this.cacheDirectory =
      options.cacheDirectory ?? path.join(homedir(), ".cache", "reachfix");
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new RangeError("OSV query batch size must be a positive integer.");
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError(
        "OSV cache TTL must be a positive number of milliseconds.",
      );
    }
  }

  async findVulnerabilities(
    dependencies: DependencyNode[],
  ): Promise<AdvisoryFinding[]> {
    const uniqueQueries = new Map<string, OsvQuery>();
    for (const dependency of dependencies) {
      const key = queryKey(dependency.name, dependency.version);
      uniqueQueries.set(key, {
        name: dependency.name,
        version: dependency.version,
      });
    }

    const advisoryByQuery = new Map<string, Advisory[]>();
    const uncached: { key: string; query: OsvQuery }[] = [];
    for (const [key, query] of uniqueQueries) {
      const cached = await this.readCache(key);
      if (cached) {
        advisoryByQuery.set(key, cached);
      } else {
        uncached.push({ key, query });
      }
    }

    for (let offset = 0; offset < uncached.length; offset += this.batchSize) {
      const batch = uncached.slice(offset, offset + this.batchSize);
      const results = await this.fetchBatch(batch.map(({ query }) => query));
      await Promise.all(
        batch.map(async ({ key }, index) => {
          const advisories = results[index] ?? [];
          advisoryByQuery.set(key, advisories);
          await this.writeCache(key, advisories);
        }),
      );
    }

    return dependencies.flatMap((dependency) => {
      const advisories =
        advisoryByQuery.get(queryKey(dependency.name, dependency.version)) ??
        [];
      const matchingAdvisories = advisories.filter((advisory) =>
        affectsPackageVersion(advisory, dependency.name, dependency.version),
      );
      return matchingAdvisories.length
        ? [{ dependency, advisories: matchingAdvisories }]
        : [];
    });
  }

  private async fetchBatch(queries: OsvQuery[]): Promise<Advisory[][]> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queries: queries.map((query) => ({
            package: { name: query.name, ecosystem: "npm" },
            version: query.version,
          })),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new OsvClientError(
        "REQUEST_FAILED",
        "Could not query the OSV.dev advisory service.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new OsvClientError(
        "REQUEST_FAILED",
        `OSV.dev returned HTTP ${response.status}.`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new OsvClientError(
        "INVALID_RESPONSE",
        "OSV.dev returned invalid JSON.",
        { cause: error },
      );
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new OsvClientError(
        "INVALID_RESPONSE",
        "OSV.dev response did not contain a results array.",
      );
    }
    if (payload.results.length !== queries.length) {
      throw new OsvClientError(
        "INVALID_RESPONSE",
        `OSV.dev returned ${payload.results.length} results for ${queries.length} queries.`,
      );
    }

    return payload.results.map((result) => {
      if (!isRecord(result)) {
        throw new OsvClientError(
          "INVALID_RESPONSE",
          "OSV.dev returned an invalid query result.",
        );
      }
      if (result.vulns === undefined) {
        return [];
      }
      if (!Array.isArray(result.vulns)) {
        throw new OsvClientError(
          "INVALID_RESPONSE",
          "OSV.dev returned an invalid vulnerabilities list.",
        );
      }
      return result.vulns.map(parseAdvisory);
    });
  }

  private async readCache(key: string): Promise<Advisory[] | undefined> {
    const cachePath = this.cachePath(key);
    let content: string;
    try {
      content = await readFile(cachePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw new OsvClientError(
        "CACHE_READ_FAILED",
        `Could not read advisory cache at ${cachePath}.`,
        { cause: error },
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new OsvClientError(
        "CACHE_READ_FAILED",
        `Advisory cache at ${cachePath} contains invalid JSON.`,
        { cause: error },
      );
    }
    if (
      !isRecord(value) ||
      typeof value.cachedAt !== "number" ||
      !Array.isArray(value.advisories)
    ) {
      throw new OsvClientError(
        "CACHE_READ_FAILED",
        `Advisory cache at ${cachePath} has an invalid shape.`,
      );
    }
    if (
      this.now() - value.cachedAt < 0 ||
      this.now() - value.cachedAt >= this.ttlMs
    ) {
      return undefined;
    }
    try {
      return value.advisories.map(parseAdvisory);
    } catch (error) {
      throw new OsvClientError(
        "CACHE_READ_FAILED",
        `Advisory cache at ${cachePath} contains invalid advisory data.`,
        { cause: error },
      );
    }
  }

  private async writeCache(key: string, advisories: Advisory[]): Promise<void> {
    const cachePath = this.cachePath(key);
    const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 });
      await writeFile(
        temporaryPath,
        JSON.stringify({
          cachedAt: this.now(),
          advisories,
        } satisfies CachedAdvisories),
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await rename(temporaryPath, cachePath);
    } catch (error) {
      throw new OsvClientError(
        "CACHE_WRITE_FAILED",
        `Could not write advisory cache at ${cachePath}.`,
        { cause: error },
      );
    }
  }

  private cachePath(key: string): string {
    return path.join(this.cacheDirectory, `${key}.json`);
  }
}

export function affectsPackageVersion(
  advisory: Advisory,
  packageName: string,
  version: string,
): boolean {
  const matchingPackages = advisory.affected.filter(
    (affected) => affected.ecosystem === "npm" && affected.name === packageName,
  );
  if (matchingPackages.length === 0) {
    return false;
  }
  return matchingPackages.some((affected) => isAffected(affected, version));
}

function isAffected(
  affected: AdvisoryAffectedPackage,
  version: string,
): boolean {
  if (affected.versions.includes(version)) {
    return true;
  }
  if (affected.ranges.length === 0) {
    return true;
  }

  const semverRanges = affected.ranges.filter(
    (range) => range.type === "SEMVER",
  );
  if (semverRanges.length === 0) {
    return true;
  }
  if (affected.ranges.some((range) => range.type !== "SEMVER")) {
    return true;
  }

  const evaluations = semverRanges.map((range) =>
    matchesSemverRange(range, version),
  );
  return (
    evaluations.some((evaluation) => evaluation === true) ||
    evaluations.includes(undefined)
  );
}

function matchesSemverRange(
  range: AdvisoryRange,
  versionText: string,
): boolean | undefined {
  const version = normalizeSemver(versionText);
  if (!version || range.events.length === 0) {
    return undefined;
  }

  let lowerBound: string | undefined;
  let hasValidInterval = false;
  for (const event of range.events) {
    if (event.introduced !== undefined) {
      if (lowerBound !== undefined) {
        return undefined;
      }
      lowerBound = event.introduced;
      continue;
    }

    const upperBound = event.fixed ?? event.last_affected ?? event.limit;
    if (upperBound === undefined || lowerBound === undefined) {
      return undefined;
    }
    const normalizedLower =
      lowerBound === "*" ? undefined : normalizeSemver(lowerBound);
    const normalizedUpper = normalizeSemver(upperBound);
    if (lowerBound !== "*" && !normalizedLower) {
      return undefined;
    }
    if (!normalizedUpper) {
      return undefined;
    }
    hasValidInterval = true;
    if (
      (normalizedLower === undefined || semver.gte(version, normalizedLower)) &&
      (event.last_affected !== undefined
        ? semver.lte(version, normalizedUpper)
        : semver.lt(version, normalizedUpper))
    ) {
      return true;
    }
    lowerBound = undefined;
  }

  if (lowerBound !== undefined) {
    const normalizedLower =
      lowerBound === "*" ? undefined : normalizeSemver(lowerBound);
    if (lowerBound !== "*" && !normalizedLower) {
      return undefined;
    }
    hasValidInterval = true;
    if (normalizedLower === undefined || semver.gte(version, normalizedLower)) {
      return true;
    }
  }
  return hasValidInterval ? false : undefined;
}

function normalizeSemver(version: string): string | undefined {
  if (version === "0") {
    return "0.0.0";
  }
  return semver.valid(version, { loose: true }) ?? undefined;
}

function parseAdvisory(value: unknown): Advisory {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned an advisory without an ID.",
    );
  }
  const affected = Array.isArray(value.affected)
    ? value.affected.map(parseAffectedPackage)
    : [];
  return {
    id: value.id,
    aliases: readStringArray(value.aliases),
    summary: typeof value.summary === "string" ? value.summary : "",
    details: typeof value.details === "string" ? value.details : "",
    ...(typeof value.published === "string"
      ? { published: value.published }
      : {}),
    ...(typeof value.modified === "string" ? { modified: value.modified } : {}),
    affected,
  };
}

function parseAffectedPackage(value: unknown): AdvisoryAffectedPackage {
  if (!isRecord(value)) {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned invalid affected-package data.",
    );
  }

  const packageObject = isRecord(value.package) ? value.package : value;
  const ecosystem =
    typeof packageObject.ecosystem === "string"
      ? packageObject.ecosystem
      : undefined;
  const name =
    typeof packageObject.name === "string" ? packageObject.name : undefined;

  if (typeof ecosystem !== "string" || typeof name !== "string") {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned an affected package without an ecosystem or name.",
    );
  }

  return {
    ecosystem,
    name,
    ranges: Array.isArray(value.ranges) ? value.ranges.map(parseRange) : [],
    versions: readStringArray(value.versions),
  };
}

function parseRange(value: unknown): AdvisoryRange {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !Array.isArray(value.events)
  ) {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned an invalid version range.",
    );
  }
  return {
    type: value.type,
    events: value.events.map(parseEvent),
  };
}

function parseEvent(value: unknown): AdvisoryEvent {
  if (!isRecord(value)) {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned an invalid range event.",
    );
  }
  const event: AdvisoryEvent = {};
  for (const key of [
    "introduced",
    "fixed",
    "last_affected",
    "limit",
  ] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string") {
        throw new OsvClientError(
          "INVALID_RESPONSE",
          "OSV.dev returned a non-string range event.",
        );
      }
      event[key] = value[key];
    }
  }
  if (Object.keys(event).length !== 1) {
    throw new OsvClientError(
      "INVALID_RESPONSE",
      "OSV.dev returned a range event with an unexpected shape.",
    );
  }
  return event;
}

function readStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return [];
  }
  return value;
}

function queryKey(name: string, version: string): string {
  return createHash("sha256").update(`npm\0${name}\0${version}`).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
