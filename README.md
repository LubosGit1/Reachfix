# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action planned to identify vulnerable npm dependencies, analyze whether vulnerable code is reachable, and verify defensive fixes.

> **Project status:** early implementation (milestones M0–M5). `scan` currently inventories dependencies and queries OSV; import reachability and a first symbol/call-path analyzer are implemented. Fix planning, version verification, and the LLM repair service exist as library APIs. The CLI `fix` and `bench` commands, Docker verification, full reports, and GitHub Action are not implemented yet.

## Requirements

- Node.js 22 or later
- pnpm 11

## Development

```sh
pnpm install
pnpm check
```

The current CLI surface is:

```sh
node dist/cli/index.js scan [path]
node dist/cli/index.js fix [path] [--advisory <id>] [--pr]
node dist/cli/index.js bench <dataset>
```

`scan` supports terminal and JSON output. `fix` and `bench` remain placeholders and return exit code `2`.

## Implemented milestones

- **M0:** project scaffold, quality checks, CI, and CLI placeholders.
- **M1:** npm package-lock v2/v3 and pnpm lockfile inventory, OSV.dev queries, and 24-hour cache.
- **M2:** import-level reachability for ESM, CommonJS, literal dynamic imports, and re-exports.
- **M3:** initial symbol/call-site analysis.
- **M4:** deterministic dependency upgrade/override plans and version verification.
- **M5:** optional Anthropic-assisted code fixes with restricted context, validated diffs, a three-attempt feedback loop, and a configured cost ceiling.

M6–M8 (reports and GitHub Action, benchmark, and release documentation) remain planned. See [SPEC.md](./SPEC.md) for the complete product scope and safety requirements.

### LLM-assisted fixes (M5)

Set `ANTHROPIC_API_KEY` to enable model calls. `ANTHROPIC_MODEL` overrides the configured model name. The fix service also accepts `maxCostUsd`; it estimates request cost before calling the API, stops when the budget would be exceeded, and logs token usage and estimated cost without logging credentials. Price estimates use configurable per-million-token rates.

Only the advisory, release notes, target type definitions, and identified call-site files are sent as context. `.env*`, `*.pem`, `*.key`, `.reachfixignore`, `.git`, `node_modules`, and files matching `.reachfixignore` patterns are excluded. Model diffs are schema-checked and restricted to those call sites and `package.json`; new dependencies and model-proposed commands are rejected or ignored.

## License

MIT
