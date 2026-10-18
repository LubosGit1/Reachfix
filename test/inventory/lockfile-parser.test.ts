import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NpmLockfileParser,
  PnpmLockfileParser,
  parseLockfile,
} from "../../src/inventory/lockfile-parser.js";
import { InventoryError } from "../../src/inventory/errors.js";

const fixturesPath = fileURLToPath(new URL("../fixtures/", import.meta.url));

describe("npm lockfile parser", () => {
  it("parses package-lock v2 with direct, development, and transitive dependencies", async () => {
    const inventory = await new NpmLockfileParser().parse(
      path.join(fixturesPath, "npm-v2"),
    );

    expect(inventory.lockfile).toEqual({ kind: "npm", version: "2" });
    expect(inventory.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "alpha",
          version: "1.2.0",
          isDirect: true,
          dependencies: ["node_modules/alpha/node_modules/vulnerable"],
        }),
        expect.objectContaining({
          name: "dev-only",
          version: "3.1.0",
          isDirect: true,
        }),
        expect.objectContaining({
          name: "vulnerable",
          version: "2.0.0",
          isDirect: false,
        }),
      ]),
    );
  });

  it("parses package-lock v3", async () => {
    const inventory = await new NpmLockfileParser().parse(
      path.join(fixturesPath, "npm-v3"),
    );

    expect(inventory.lockfile).toEqual({ kind: "npm", version: "3" });
    expect(inventory.dependencies).toEqual([
      expect.objectContaining({
        name: "vulnerable",
        version: "2.2.0",
        isDirect: true,
      }),
    ]);
  });
});

describe("pnpm lockfile parser", () => {
  it("parses v9 package snapshots and resolves transitive dependency paths", async () => {
    const inventory = await new PnpmLockfileParser().parse(
      path.join(fixturesPath, "pnpm-v9"),
    );

    expect(inventory.lockfile).toEqual({ kind: "pnpm", version: "9.0" });
    expect(inventory.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "alpha",
          version: "1.2.0",
          isDirect: true,
          dependencies: ["pnpm:vulnerable@2.0.0"],
        }),
        expect.objectContaining({
          name: "vulnerable",
          version: "2.0.0",
          isDirect: false,
        }),
      ]),
    );
  });
});

describe("lockfile selection", () => {
  it("selects the supported lockfile in a project", async () => {
    await expect(
      parseLockfile(path.join(fixturesPath, "npm-v3")),
    ).resolves.toMatchObject({ lockfile: { kind: "npm", version: "3" } });
  });

  it("reports when neither supported lockfile exists", async () => {
    await expect(
      parseLockfile(path.join(fixturesPath, "missing")),
    ).rejects.toMatchObject({
      name: "InventoryError",
      code: "LOCKFILE_NOT_FOUND",
    } satisfies Partial<InventoryError>);
  });
});
