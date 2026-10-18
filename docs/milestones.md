# Project milestones

This document records the implementation history. For current capabilities
and usage, see the [README](../README.md).

- **M0:** project scaffold, quality checks, CI, and CLI placeholders.
- **M1:** npm package-lock v2/v3 and pnpm lockfile inventory, OSV.dev queries,
  and 24-hour cache.
- **M2:** import-level reachability for ESM, CommonJS, literal dynamic imports,
  and re-exports.
- **M3:** initial symbol and call-site analysis for named imports,
  destructuring, aliases, and namespace calls.
- **M4:** deterministic dependency upgrade/override plans, lockfile target
  checks, and Docker-isolated baseline/candidate verification.
- **M5:** optional Anthropic-assisted code fixes with restricted context,
  validated diffs, a three-attempt feedback loop, and a configured cost
  ceiling.
- **M6:** text, JSON, SARIF 2.1.0, and Markdown reports; CLI scan thresholds;
  and a GitHub Action for SARIF upload.
- **M7:** pinned-commit benchmark runner, npm audit comparison, conservative
  metrics, case templates, and a generated README table.
- **M8:** architecture and limitations documentation, benchmark metric
  definitions, AI-assisted development safeguards, and a release checklist.
- **M9:** deterministic reachable-dependency upgrades staged before
  application, Docker baseline verification, and optional GitHub CLI PR
  creation.
