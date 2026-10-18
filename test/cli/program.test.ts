import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/program.js";

describe("CLI program", () => {
  it("registers the scan, fix, and bench commands", () => {
    const commandNames = createProgram()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toEqual(["bench", "fix", "scan"]);
  });
});
