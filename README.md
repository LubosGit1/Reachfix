# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action that scans npm
dependencies for known advisories and uses source-level import and call
evidence to assess reachability. It exists to help teams prioritize dependency
alerts and verify an upgrade before applying or proposing it.

```text
PACKAGE         ADVISORY             REACHABILITY  EVIDENCE
lodash@4.17.20  GHSA-xxjr-mmjv-4gpg  REACHABLE     src/index.js:2 (lodash.omit())
```

The scan is static and does not execute the project. `REACHABLE` indicates
that the shown call was found. When advisory text exposes a recognizable
affected function name, Reachfix checks for a call to that function; this
heuristic still does not prove that vulnerable conditions or untrusted input
reach it.

> **Project status:** scanning, reporting, GitHub Action integration, and
> Docker-verified dependency upgrades are implemented. The benchmark includes
> manually annotated cases; see its limitations and results below.

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

## What works today

- Scans npm lockfiles, retrieves OSV advisories, and reports import and
  supported call-site evidence.
- Emits terminal, JSON, SARIF, and Markdown reports; a GitHub Action can scan
  and upload SARIF.
- Stages a dependency upgrade and applies it only after Docker-isolated
  baseline and candidate checks pass. Optional pull request creation uses
  GitHub CLI.
- Runs a manually labeled benchmark. Its current sample is small and
  repository-diverse results are not yet sufficient for broad performance or
  precision claims.

### Try a vulnerability scan

From the repository root, build Reachfix and create a disposable project that
imports an outdated lodash release with known OSV advisories:

```sh
REACHFIX_ROOT="$(pwd)"
pnpm build
DEMO_DIR="$(mktemp -d)"
cd "$DEMO_DIR"
npm init -y
npm install --package-lock-only --ignore-scripts --no-audit --no-fund lodash@4.17.20
printf 'const lodash = require("lodash");\nlodash.omit({}, ["absent"]);\n' > index.js
node "$REACHFIX_ROOT/dist/cli/index.js" scan "$DEMO_DIR" --fail-on never
```

The scan needs network access to query OSV.dev. It should report known lodash
advisories and point to `index.js` and the `lodash.omit()` call. This call-site
evidence does not prove that a particular advisory's vulnerable path is
triggered or that untrusted input reaches the function. The scan does not
execute project code.
`--fail-on never` keeps findings from setting the command's failure exit code.
The disposable project is created under the system temporary directory and can
be removed when you are done.

### GitHub Action

Use the example workflow at [examples/reachfix.yml](./examples/reachfix.yml). Grant `security-events: write` to upload SARIF. The action scans by default and uploads a SARIF 2.1.0 report. The example keeps `fix: false`; opt in with `fix: true` to open a PR only after a reachable dependency upgrade passes Docker verification. This additionally requires `contents: write` and `pull-requests: write` workflow permissions and GitHub CLI authentication. The scan threshold is still evaluated after PR creation and may fail the workflow until the fix is merged and rescanned.

Fixes are limited to one dependency per invocation. The LLM repair service is
available as a lower-level component, but the `fix` command does not call it;
automated caller-code migrations and multi-advisory remediation are not
implemented. See [Limitations and interpreting results](./docs/limitations.md)
before relying on scan or benchmark output. The development history is in
[milestones](./docs/milestones.md).

### Benchmark (M7)

Benchmark ground truth is intentionally manual. Create a case template with `pnpm bench:case -- <case-id>`, then edit `bench/cases/<case-id>.json` with a public repository URL, immutable 40-character commit SHA, advisory ID, expected verdict, and evidence-based rationale. The loader also accepts JSON arrays for curated bundles. Review every verdict independently; do not treat analyzer output as ground truth. Metrics are withheld from the README until an individual run has at least 50 cases and at least 30% ground-truth `REACHABLE` cases.

The checked-in dataset contains 53 package/advisory cases: 28 `REACHABLE`, 13 `NOT_REACHABLE`, and 12 `UNKNOWN`. It pins two intentionally vulnerable training applications and three established projects: [Snyk-learn/nodejs-goof](https://github.com/Snyk-learn/nodejs-goof), [OWASP/NodeGoat](https://github.com/OWASP/NodeGoat), [Axios](https://github.com/axios/axios), [Mocha](https://github.com/mochajs/mocha), and [nyc](https://github.com/istanbuljs/nyc). The three additional cases are transitive development dependencies and are intentionally labeled `UNKNOWN`; this adds repository diversity but does not yet make the sample representative of production applications. See the evidence in [curated-cases.json](./bench/cases/curated-cases.json) and [lodash-prototype-pollution-nodejs-goof.json](./bench/cases/lodash-prototype-pollution-nodejs-goof.json).

Run cases using `pnpm bench bench/cases`. Each case is checked out at its pinned commit without running repository scripts. reachfix scans it statically; `npm audit --json --package-lock-only --ignore-scripts` provides the comparison count. Alert reduction compares unique vulnerable package names reported by each tool, counting `UNKNOWN` reachfix packages as alerts and counting each repository commit once even when it has several advisory cases. Results are written to `bench/results/<UTC-date>.json`. A date can be written only once, so copy or rename a prior result before rerunning on the same day. Run `pnpm bench:report` to regenerate the table below. Missing advisory results remain `UNKNOWN`, not `NOT_REACHABLE`. Fix success and API cost are not yet benchmarked.

<!-- reachfix-benchmark:start -->

## Benchmark results

> Only manually reviewed runs with at least 50 cases and 30% ground-truth REACHABLE cases are shown.

| Date       | Cases | Audit packages | Reachfix packages | Recall | Precision | Alert reduction | Fix success | Median time | Avg. API cost |
| ---------- | ----: | -------------: | ----------------: | -----: | --------: | --------------: | ----------: | ----------: | ------------: |
| 2026-10-18 |    53 |            400 |               228 | 100.0% |     78.9% |           43.0% |         n/a |     3478 ms |           n/a |

<!-- reachfix-benchmark:end -->

### LLM-assisted code repair

Set `ANTHROPIC_API_KEY` to enable model calls. `ANTHROPIC_MODEL` overrides the configured model name. The fix service also accepts `maxCostUsd`; it estimates request cost before calling the API, stops when the budget would be exceeded, and logs token usage and estimated cost without logging credentials. Price estimates use configurable per-million-token rates.

The LLM repair service exists as a lower-level component but is not invoked by
the `fix` command or GitHub Action. Only the advisory, release notes, target
type definitions, and identified call-site files are sent as context. `.env*`,
`*.pem`, `*.key`, `.reachfixignore`, `.git`, `node_modules`, and files matching
`.reachfixignore` patterns are excluded. Model diffs are schema-checked and
restricted to those call sites and `package.json`; new dependencies and
model-proposed commands are rejected or ignored.

## License

MIT
