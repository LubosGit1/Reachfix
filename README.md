# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action planned to identify vulnerable npm dependencies, analyze whether vulnerable code is reachable, and verify defensive fixes.

> **Project status:** early implementation (milestones M0–M7). `scan` inventories dependencies, queries OSV, and reports import/symbol reachability. Terminal, JSON, SARIF 2.1.0, and Markdown formats are available. The GitHub Action scans and uploads SARIF. Automatic fixes and PR creation remain disabled until fixes can be verified in the required Docker sandbox.

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

`scan --format` accepts `text`, `json`, `sarif`, or `markdown`. `--fail-on` accepts `reachable` (default), `unknown`, `any`, or `never`. Exit codes are `0` when the threshold is not met, `1` when it is met, and `2` for a tool error. `fix` remains a placeholder and returns exit code `2`.

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
- **M7:** pinned-commit benchmark runner, npm audit comparison, conservative metrics, case templates, and generated README table.

M8 (release documentation and publishing) remains planned. Verified fix pull requests remain gated on the Docker sandbox. See [SPEC.md](./SPEC.md) for the complete product scope and safety requirements.

### Benchmark (M7)

Benchmark ground truth is intentionally manual. Create a case template with `pnpm bench:case -- <case-id>`, then edit `bench/cases/<case-id>.json` with a public repository URL, immutable 40-character commit SHA, advisory ID, expected verdict, and evidence-based rationale. Review every verdict yourself; do not treat analyzer output as ground truth. Aim for 50–100 real cases and at least 30% `REACHABLE` cases before publishing metrics.

Run cases using `pnpm bench bench/cases`. Each case is checked out at its pinned commit without running repository scripts. reachfix scans it statically; `npm audit --json --package-lock-only --ignore-scripts` provides the comparison count. Results are written to `bench/results/<UTC-date>.json`. A date can be written only once, so copy or rename a prior result before rerunning on the same day. Run `pnpm bench:report` to regenerate the table below. Missing advisory results remain `UNKNOWN`, not `NOT_REACHABLE`. Fix success and API cost are not yet benchmarked; fix attempts are not part of M7.

<!-- reachfix-benchmark:start -->

## Benchmark results

> No benchmark metrics are published until a curated, manually labeled dataset is run.

| Date | Cases | Recall | Precision | Alert reduction | Fix success | Median time | Avg. API cost |
| ---- | ----: | -----: | --------: | --------------: | ----------: | ----------: | ------------: |

<!-- reachfix-benchmark:end -->

### LLM-assisted fixes (M5)

Set `ANTHROPIC_API_KEY` to enable model calls. `ANTHROPIC_MODEL` overrides the configured model name. The fix service also accepts `maxCostUsd`; it estimates request cost before calling the API, stops when the budget would be exceeded, and logs token usage and estimated cost without logging credentials. Price estimates use configurable per-million-token rates.

Only the advisory, release notes, target type definitions, and identified call-site files are sent as context. `.env*`, `*.pem`, `*.key`, `.reachfixignore`, `.git`, `node_modules`, and files matching `.reachfixignore` patterns are excluded. Model diffs are schema-checked and restricted to those call sites and `package.json`; new dependencies and model-proposed commands are rejected or ignored.

## License

MIT
