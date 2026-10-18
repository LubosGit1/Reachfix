# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action planned to identify vulnerable npm dependencies, analyze whether vulnerable code is reachable, and verify defensive fixes.

> **Project status:** milestones M0–M9 are implemented. `scan` inventories dependencies, queries OSV, and reports import/symbol reachability. Terminal, JSON, SARIF 2.1.0, and Markdown formats are available. The GitHub Action scans and uploads SARIF. `fix` stages a reachable dependency upgrade, verifies it against a clean baseline in Docker, and applies only the verified manifest and lockfile changes; optional PR creation uses GitHub CLI. The benchmark runner is implemented, but the dataset still needs manually reviewed ground-truth cases before publishing metrics.

Documentation: [architecture](./docs/architecture.md), [limitations and result interpretation](./docs/limitations.md), [AI-assisted development and release process](./docs/ai-development-and-release.md), and the full [project specification](./SPEC.md).

## Requirements

- Node.js 22 or later
- pnpm 11

## Development

```sh
pnpm install
pnpm check
pnpm build
```

The current CLI surface is:

```sh
node dist/cli/index.js scan [path]
node dist/cli/index.js scan [path] --format sarif --output reachfix.sarif
node dist/cli/index.js fix [path] [--advisory <id>] [--pr]
node dist/cli/index.js bench <dataset>
```

`scan --format` accepts `text`, `json`, `sarif`, or `markdown`. `--fail-on` accepts `reachable` (default), `unknown`, `any`, or `never`. Exit codes are `0` when the threshold is not met, `1` when it is met, and `2` for a tool error. `fix` considers reachable findings only, selects a fixed version reported by OSV, updates a temporary copy, and applies only package manifest/lockfile changes after Docker verification against a clean baseline. `fix --pr` also creates a branch, commits those files, pushes it, and opens a pull request with GitHub CLI; it requires a clean Git worktree, `gh` authentication, and `contents: write`/`pull-requests: write` permissions.

### GitHub Action

Use the example workflow at [examples/reachfix.yml](./examples/reachfix.yml). Grant `security-events: write` to upload SARIF. The action scans by default and uploads a SARIF 2.1.0 report. The example keeps `fix: false`; opt in with `fix: true` to open a PR only after a reachable dependency upgrade passes Docker verification. This additionally requires `contents: write` and `pull-requests: write` workflow permissions and GitHub CLI authentication. The scan threshold is still evaluated after PR creation and may fail the workflow until the fix is merged and rescanned.

## Implemented milestones

- **M0:** project scaffold, quality checks, CI, and CLI placeholders.
- **M1:** npm package-lock v2/v3 and pnpm lockfile inventory, OSV.dev queries, and 24-hour cache.
- **M2:** import-level reachability for ESM, CommonJS, literal dynamic imports, and re-exports.
- **M3:** initial symbol/call-site analysis.
- **M4:** deterministic dependency upgrade/override plans, lockfile target checks, and Docker-isolated baseline/candidate verification.
- **M5:** optional Anthropic-assisted code fixes with restricted context, validated diffs, a three-attempt feedback loop, and a configured cost ceiling.
- **M6:** text, JSON, SARIF 2.1.0, and Markdown reports; CLI scan thresholds; and a GitHub Action for SARIF upload.
- **M7:** pinned-commit benchmark runner, npm audit comparison, conservative metrics, case templates, and generated README table.
- **M8:** architecture and limitations documentation, benchmark metric definitions, AI-assisted development safeguards, and a release checklist.
- **M9:** deterministic reachable-dependency upgrades staged before application, Docker baseline verification, and optional GitHub CLI PR creation.

Fixes are limited to a single direct or transitive dependency per invocation. Code-level fixes and multi-advisory remediation are not automated. See [Limitations and interpreting results](./docs/limitations.md) before relying on scan or benchmark output.

### Benchmark (M7)

Benchmark ground truth is intentionally manual. Create a case template with `pnpm bench:case -- <case-id>`, then edit `bench/cases/<case-id>.json` with a public repository URL, immutable 40-character commit SHA, advisory ID, expected verdict, and evidence-based rationale. Review every verdict yourself; do not treat analyzer output as ground truth. Metrics are withheld from the README until an individual run has at least 50 cases and at least 30% ground-truth `REACHABLE` cases.

The checked-in dataset currently has one evidence-backed seed case, [lodash-prototype-pollution-nodejs-goof](./bench/cases/lodash-prototype-pollution-nodejs-goof.json). It is not representative; expand and review the dataset before publishing metrics.

Run cases using `pnpm bench bench/cases`. Each case is checked out at its pinned commit without running repository scripts. reachfix scans it statically; `npm audit --json --package-lock-only --ignore-scripts` provides the comparison count. Results are written to `bench/results/<UTC-date>.json`. A date can be written only once, so copy or rename a prior result before rerunning on the same day. Run `pnpm bench:report` to regenerate the table below. Missing advisory results remain `UNKNOWN`, not `NOT_REACHABLE`. Fix success and API cost are not yet benchmarked; fix attempts are not part of M7.

<!-- reachfix-benchmark:start -->

## Benchmark results

> Metrics are withheld until a manually reviewed run contains at least 50 cases and 30% ground-truth REACHABLE cases.

| Date | Cases | Recall | Precision | Alert reduction | Fix success | Median time | Avg. API cost |
| ---- | ----: | -----: | --------: | --------------: | ----------: | ----------: | ------------: |

<!-- reachfix-benchmark:end -->

### LLM-assisted fixes (M5)

Set `ANTHROPIC_API_KEY` to enable model calls. `ANTHROPIC_MODEL` overrides the configured model name. The fix service also accepts `maxCostUsd`; it estimates request cost before calling the API, stops when the budget would be exceeded, and logs token usage and estimated cost without logging credentials. Price estimates use configurable per-million-token rates.

Only the advisory, release notes, target type definitions, and identified call-site files are sent as context. `.env*`, `*.pem`, `*.key`, `.reachfixignore`, `.git`, `node_modules`, and files matching `.reachfixignore` patterns are excluded. Model diffs are schema-checked and restricted to those call sites and `package.json`; new dependencies and model-proposed commands are rejected or ignored.

## License

MIT
