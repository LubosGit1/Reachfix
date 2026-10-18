import { readWantedLockfile } from "@pnpm/lockfile-file";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { InventoryError } from "./errors.js";
import type { DependencyInventory, DependencyNode } from "../types.js";

interface PackageManifest {
  dependencies: Set<string>;
}

interface NpmPackageEntry {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface NpmLockfile {
  lockfileVersion: number;
  packages: Record<string, NpmPackageEntry>;
}

interface PnpmDependencyReference {
  name: string;
  version: string;
}

interface PnpmPackageEntry {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface LockfileParser {
  parse(projectPath: string): Promise<DependencyInventory>;
}

export class NpmLockfileParser implements LockfileParser {
  async parse(projectPath: string): Promise<DependencyInventory> {
    const absolutePath = path.resolve(projectPath);
    const manifest = await readManifest(absolutePath);
    const lockfilePath = path.join(absolutePath, "package-lock.json");
    const lockfile = await readJsonFile(lockfilePath, "npm lockfile");

    if (
      !isRecord(lockfile) ||
      typeof lockfile.lockfileVersion !== "number" ||
      ![2, 3].includes(lockfile.lockfileVersion) ||
      !isRecord(lockfile.packages)
    ) {
      throw new InventoryError(
        "UNSUPPORTED_LOCKFILE",
        `Unsupported or invalid npm lockfile at ${lockfilePath}; expected package-lock.json v2 or v3.`,
      );
    }

    const npmLockfile = lockfile as unknown as NpmLockfile;
    const nodes = new Map<string, DependencyNode>();
    for (const [installPath, value] of Object.entries(npmLockfile.packages)) {
      if (!installPath.startsWith("node_modules/") || !isRecord(value)) {
        continue;
      }

      const entry = value as NpmPackageEntry;
      const name = entry.name ?? packageNameFromNpmPath(installPath);
      if (typeof name !== "string" || typeof entry.version !== "string") {
        continue;
      }

      nodes.set(installPath, {
        name,
        version: entry.version,
        lockfilePath: installPath,
        isDirect:
          manifest.dependencies.has(name) &&
          installPath === `node_modules/${name}`,
        dependencies: [],
      });
    }

    for (const [installPath, node] of nodes) {
      const entry = npmLockfile.packages[installPath];
      if (!entry) {
        continue;
      }
      node.dependencies = resolveNpmDependencies(
        installPath,
        mergeDependencyNames(entry.dependencies, entry.optionalDependencies),
        nodes,
      );
    }

    return {
      projectPath: absolutePath,
      lockfile: {
        kind: "npm",
        version: String(npmLockfile.lockfileVersion),
      },
      dependencies: [...nodes.values()],
    };
  }
}

export class PnpmLockfileParser implements LockfileParser {
  async parse(projectPath: string): Promise<DependencyInventory> {
    const absolutePath = path.resolve(projectPath);
    const manifest = await readManifest(absolutePath);

    let lockfile;
    try {
      lockfile = await readWantedLockfile(absolutePath, {
        ignoreIncompatible: false,
      });
    } catch (error) {
      throw new InventoryError(
        "INVALID_LOCKFILE",
        `Could not parse pnpm lockfile in ${absolutePath}.`,
        { cause: error },
      );
    }
    if (!lockfile) {
      throw new InventoryError(
        "LOCKFILE_NOT_FOUND",
        `No pnpm-lock.yaml found in ${absolutePath}.`,
      );
    }
    const importerEntries = Object.entries(lockfile.importers);
    if (importerEntries.length !== 1 || importerEntries[0]?.[0] !== ".") {
      throw new InventoryError(
        "UNSUPPORTED_LOCKFILE",
        "pnpm workspaces are not supported; expected a single root importer.",
      );
    }

    const [importer] = importerEntries.map(([, value]) => value);
    const directReferences = [
      ...Object.entries(importer?.dependencies ?? {}),
      ...Object.entries(importer?.devDependencies ?? {}),
      ...Object.entries(importer?.optionalDependencies ?? {}),
    ];
    const directNames = new Set([
      ...manifest.dependencies,
      ...directReferences.map(([name]) => name),
    ]);
    const packageEntries = Object.entries(lockfile.packages ?? {});
    const packageReferences = packageEntries.flatMap(([depPath, entry]) => {
      const parsed = parsePnpmDependencyPath(depPath);
      return parsed ? [{ depPath, entry, ...parsed }] : [];
    });
    const nodes = new Map<string, DependencyNode>();

    for (const item of packageReferences) {
      nodes.set(item.depPath, {
        name: item.name,
        version: item.version,
        lockfilePath: `pnpm:${item.depPath}`,
        isDirect: false,
        dependencies: [],
      });
    }

    for (const [name, reference] of directReferences) {
      for (const match of resolvePnpmReference(
        name,
        reference,
        packageReferences,
      )) {
        const node = nodes.get(match.depPath);
        if (node && directNames.has(name)) {
          node.isDirect = true;
        }
      }
    }

    for (const item of packageReferences) {
      const node = nodes.get(item.depPath);
      if (!node) {
        continue;
      }
      node.dependencies = resolvePnpmDependencies(
        item.entry,
        packageReferences,
        nodes,
      );
    }

    return {
      projectPath: absolutePath,
      lockfile: {
        kind: "pnpm",
        version: lockfile.lockfileVersion,
      },
      dependencies: [...nodes.values()],
    };
  }
}

export async function parseLockfile(
  projectPath: string,
): Promise<DependencyInventory> {
  const absolutePath = path.resolve(projectPath);
  const npmExists = await fileExists(
    path.join(absolutePath, "package-lock.json"),
  );
  const pnpmExists = await fileExists(
    path.join(absolutePath, "pnpm-lock.yaml"),
  );

  if (npmExists && pnpmExists) {
    throw new InventoryError(
      "MULTIPLE_LOCKFILES",
      `Found both package-lock.json and pnpm-lock.yaml in ${absolutePath}; keep one lockfile.`,
    );
  }
  if (npmExists) {
    return new NpmLockfileParser().parse(absolutePath);
  }
  if (pnpmExists) {
    return new PnpmLockfileParser().parse(absolutePath);
  }
  throw new InventoryError(
    "LOCKFILE_NOT_FOUND",
    `No supported package-lock.json or pnpm-lock.yaml found in ${absolutePath}.`,
  );
}

async function readManifest(projectPath: string): Promise<PackageManifest> {
  const manifestPath = path.join(projectPath, "package.json");
  const manifest = await readJsonFile(manifestPath, "package manifest");
  if (!isRecord(manifest)) {
    throw new InventoryError(
      "INVALID_MANIFEST",
      `Invalid package.json at ${manifestPath}.`,
    );
  }
  return {
    dependencies: new Set([
      ...readDependencyNames(manifest.dependencies),
      ...readDependencyNames(manifest.devDependencies),
      ...readDependencyNames(manifest.optionalDependencies),
    ]),
  };
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw new InventoryError(
      "INVALID_LOCKFILE",
      `Could not read ${label} at ${filePath}.`,
      { cause: error },
    );
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new InventoryError(
      "INVALID_LOCKFILE",
      `Invalid JSON in ${label} at ${filePath}.`,
      { cause: error },
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw new InventoryError(
      "INVALID_LOCKFILE",
      `Could not inspect lockfile at ${filePath}.`,
      { cause: error },
    );
  }
}

function readDependencyNames(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function mergeDependencyNames(
  ...dependencyMaps: (Record<string, string> | undefined)[]
): string[] {
  return [...new Set(dependencyMaps.flatMap(readDependencyNames))];
}

function packageNameFromNpmPath(installPath: string): string | undefined {
  const marker = "node_modules/";
  const packageStart = installPath.lastIndexOf(marker) + marker.length;
  const segments = installPath.slice(packageStart).split("/");
  if (segments.length > 1 && segments[0]?.startsWith("@")) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

function resolveNpmDependencies(
  installPath: string,
  dependencyNames: string[],
  nodes: Map<string, DependencyNode>,
): string[] {
  const resolved: string[] = [];
  for (const name of dependencyNames) {
    let parentPath = installPath;
    while (true) {
      const candidate = `${parentPath ? `${parentPath}/` : ""}node_modules/${name}`;
      const target = nodes.get(candidate);
      if (target) {
        resolved.push(target.lockfilePath);
        break;
      }
      const parentMarker = parentPath.lastIndexOf("/node_modules/");
      if (parentMarker >= 0) {
        parentPath = parentPath.slice(0, parentMarker);
      } else {
        if (parentPath.startsWith("node_modules/")) {
          parentPath = "";
        } else {
          break;
        }
      }
      if (parentPath === "" && !nodes.has(`node_modules/${name}`)) {
        break;
      }
    }
  }
  return [...new Set(resolved)];
}

function parsePnpmDependencyPath(
  depPath: string,
): PnpmDependencyReference | undefined {
  const packageAndVersion = depPath.startsWith("/")
    ? depPath.slice(1)
    : depPath;
  let name: string;
  let versionPart: string | undefined;

  if (packageAndVersion.startsWith("@") && packageAndVersion.includes("/")) {
    const scopeEnd = packageAndVersion.indexOf("/");
    const versionSeparator = packageAndVersion.lastIndexOf("@");
    if (versionSeparator <= scopeEnd) {
      const segments = packageAndVersion.split("/");
      if (segments.length < 3) {
        return undefined;
      }
      name = `${segments[0]}/${segments[1]}`;
      versionPart = segments.slice(2).join("/");
    } else {
      name = packageAndVersion.slice(0, versionSeparator);
      versionPart = packageAndVersion.slice(versionSeparator + 1);
    }
  } else {
    const versionSeparator = packageAndVersion.lastIndexOf("@");
    if (versionSeparator > 0) {
      name = packageAndVersion.slice(0, versionSeparator);
      versionPart = packageAndVersion.slice(versionSeparator + 1);
    } else {
      const slash = packageAndVersion.indexOf("/");
      if (slash < 0) {
        return undefined;
      }
      name = packageAndVersion.slice(0, slash);
      versionPart = packageAndVersion.slice(slash + 1);
    }
  }

  const version = versionPart?.split(/[(_]/, 1)[0];
  if (!name || !version) {
    return undefined;
  }
  return { name, version };
}

function resolvePnpmReference(
  name: string,
  reference: string,
  packages: PnpmPackageReference[],
): PnpmPackageReference[] {
  const normalizedReference = reference.replace(/^npm:/, "");
  const aliasSeparator = normalizedReference.lastIndexOf("@");
  const expectedName =
    normalizedReference.startsWith("@") && aliasSeparator > 0
      ? normalizedReference.slice(0, aliasSeparator)
      : name;
  const expectedVersion =
    expectedName === name && aliasSeparator > 0
      ? normalizedReference.slice(aliasSeparator + 1)
      : normalizedReference;
  if (reference.startsWith("link:") || reference.startsWith("file:")) {
    return [];
  }
  return packages.filter(
    (item) =>
      item.name === expectedName &&
      (item.depPath.endsWith(`@${normalizedReference}`) ||
        item.version === expectedVersion ||
        item.depPath.includes(`@${expectedVersion}(`) ||
        item.depPath.includes(`@${expectedVersion}_`)),
  );
}

interface PnpmPackageReference extends PnpmDependencyReference {
  depPath: string;
  entry: PnpmPackageEntry;
}

function resolvePnpmDependencies(
  entry: PnpmPackageEntry,
  packages: PnpmPackageReference[],
  nodes: Map<string, DependencyNode>,
): string[] {
  const dependencies: string[] = [];
  for (const [name, reference] of Object.entries({
    ...entry.dependencies,
    ...entry.optionalDependencies,
  })) {
    for (const match of resolvePnpmReference(name, reference, packages)) {
      const target = nodes.get(match.depPath);
      if (target) {
        dependencies.push(target.lockfilePath);
      }
    }
  }
  return [...new Set(dependencies)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
