# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action planned to identify vulnerable npm dependencies, analyze whether vulnerable code is reachable, and verify defensive fixes.

> **Project status:** early implementation (milestones M0–M6). `scan` inventories dependencies, queries OSV, and reports import/symbol reachability. Terminal, JSON, SARIF 2.1.0, and Markdown formats are available. The GitHub Action scans and uploads SARIF. Automatic fixes and PR creation remain disabled until fixes can be verified in the required Docker sandbox.

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
node dist/cli/index.js scan [path] --format sarif --output reachfix.sarif
node dist/cli/index.js fix [path] [--advisory <id>] [--pr]
node dist/cli/index.js bench <dataset>
```

`scan --format` accepts `text`, `json`, `sarif`, or `markdown`. `--fail-on` accepts `reachable` (default), `unknown`, `any`, or `never`. Exit codes are `0` when the threshold is not met, `1` when it is met, and `2` for a tool error. `fix` and `bench` remain placeholders and return exit code `2`.

### GitHub Action

Use the example workflow at [examples/reachfix.yml](./examples/reachfix.yml). Grant `security-events: write` to upload SARIF. The action scans by default and uploads a SARIF 2.1.0 report. `fix: true` is deliberately rejected without applying changes: verified PR generation must wait for the isolated Docker verification milestone.

## Implemented milestones

- **M0:** project scaffold, quality checks, CI, and CLI placeholders.
- **M1:** npm package-lock v2/v3 and pnpm lockfile inventory, OSV.dev queries, and 24-hour cache.
- **M2:** import-level reachability for ESM, CommonJS, literal dynamic imports, and re-exports.
- **M3:** initial symbol/call-site analysis.
- **M4:** deterministic dependency upgrade/override plans and version verification.
- **M5:** optional Anthropic-assisted code fixes with restricted context, validated diffs, a three-attempt feedback loop, and a configured cost ceiling.
- **M6:** text, JSON, SARIF 2.1.0, and Markdown reports; CLI scan thresholds; and a GitHub Action for SARIF upload.

M7–M8 (benchmark and release documentation) remain planned. Verified fix pull requests remain gated on the Docker sandbox. See [SPEC.md](./SPEC.md) for the complete product scope and safety requirements.

### LLM-assisted fixes (M5)

Set `ANTHROPIC_API_KEY` to enable model calls. `ANTHROPIC_MODEL` overrides the configured model name. The fix service also accepts `maxCostUsd`; it estimates request cost before calling the API, stops when the budget would be exceeded, and logs token usage and estimated cost without logging credentials. Price estimates use configurable per-million-token rates.

Only the advisory, release notes, target type definitions, and identified call-site files are sent as context. `.env*`, `*.pem`, `*.key`, `.reachfixignore`, `.git`, `node_modules`, and files matching `.reachfixignore` patterns are excluded. Model diffs are schema-checked and restricted to those call sites and `package.json`; new dependencies and model-proposed commands are rejected or ignored.

## License

MIT
