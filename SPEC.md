# reachfix project specification

## Goal

Provide a defensive CLI and GitHub Action for JavaScript and TypeScript npm projects that identifies known vulnerable dependencies, conservatively determines whether vulnerable code is reachable, and verifies proposed fixes in an isolated environment. Favor `UNKNOWN` over a false `NOT_REACHABLE` result.

## Version 1 scope

- JavaScript and TypeScript projects using npm `package-lock.json` v2/v3 or `pnpm-lock.yaml`.
- Direct and transitive dependencies, with advisories from OSV.dev and optionally GitHub Advisory Database.
- Static import, symbol, and call-path analysis.
- Version upgrades and caller-code updates, verified in Docker.
- Terminal, JSON, SARIF 2.1.0, and pull-request Markdown reports.

Out of scope: exploit or proof-of-concept generation, dynamic analysis, fuzzing, other ecosystems, `yarn.lock`, monorepo workspaces, and zero-day discovery in application code.

## Safety requirements

- Treat repository code and model output as untrusted input.
- Never run target-repository code outside the verification sandbox.
- Unit tests must not access the network or Docker; inject these boundaries.
- Never send secrets or ignored files to an LLM, and never execute commands proposed by a model.
- Do not generate exploits, proof-of-concept attacks, or payloads.
- An uncertain analysis result must remain `UNKNOWN`, never `NOT_REACHABLE`.

## Milestones

1. **M0 – Scaffold:** TypeScript, lint, tests, CI, development guidance, and CLI placeholders.
2. **M1 – Inventory and advisories:** parse supported lockfiles and query OSV with a disk cache.
3. **M2 – Import reachability:** analyze ESM, CommonJS, dynamic literal imports, and re-exports.
4. **M3 – Symbols and call paths:** map advisories to symbols and conservatively trace call paths.
5. **M4 – Deterministic fixes and verification:** upgrades, overrides, sandbox baseline, and comparison.
6. **M5 – LLM-assisted fixes:** use `@anthropic-ai/sdk` with a configurable model and `ANTHROPIC_API_KEY`; provide only the advisory, release notes, target type definitions, and call-site files. Validate tool output with Zod, apply exact unified diffs restricted to call sites and `package.json`, prohibit new dependencies and model-proposed commands, retry verification feedback at most three times, and enforce/log `maxCostUsd`.
7. **M6 – Reports and GitHub Action:** terminal, JSON, SARIF 2.1.0, and Markdown report renderers; threshold-based scan exit codes; and a scan-by-default GitHub Action that uploads SARIF. Automatic fix PRs remain disabled until Docker verification can guarantee the required verification gate.
8. **M7 – Benchmark:** reproducible, manually labeled cases and generated metrics.
9. **M8 – Documentation and release:** explain architecture, limits, results, and AI-assisted development.
