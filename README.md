# reachfix

**reachfix** reduces npm vulnerability noise by checking whether vulnerable
dependencies are used in application source, then stages an upgrade and
verifies it in Docker before applying the change or opening a pull request.
It exists because a vulnerable package in a lockfile does not by itself show
whether the application uses it. Scans are static and do not execute the
scanned project.

```text
PACKAGE         ADVISORY             REACHABILITY  EVIDENCE
lodash@4.17.20  GHSA-xxjr-mmjv-4gpg  REACHABLE     src/index.js:2 (lodash.omit())
```

`REACHABLE` means the shown call was found; it does not prove that the
advisory's vulnerable conditions hold or that untrusted input reaches the
call.

## What works today

- Scans npm lockfiles, retrieves OSV advisories, and reports import and
  supported call-site evidence.
- Emits terminal, JSON, SARIF, and Markdown reports; a GitHub Action can scan
  and upload SARIF.
- Stages a dependency upgrade and applies it only after Docker-isolated
  baseline and candidate checks pass. Optional pull request creation uses
  GitHub CLI.
- Runs a manually labeled benchmark. Its current sample is small and
  repository-diverse results are not yet sufficient for broad performance
  claims.

## Try a vulnerability scan

From the repository root, build reachfix and create a disposable project that
uses an outdated lodash release with known OSV advisories:

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
advisories and point to `index.js` and the `lodash.omit()` call. The call-site
evidence does not establish exploitability. `--fail-on never` keeps findings
from setting the command's failure exit code.

## GitHub Action

Use the example workflow at [examples/reachfix.yml](./examples/reachfix.yml).
Grant `security-events: write` to upload SARIF. The example keeps `fix: false`;
opt in with `fix: true` to open a PR only after a reachable dependency upgrade
passes Docker verification. This additionally requires `contents: write` and
`pull-requests: write` workflow permissions and GitHub CLI authentication.
The scan threshold is evaluated after PR creation and may fail the workflow
until the fix is merged and rescanned.

## Benchmark

The checked-in dataset contains 65 cases: 29 `REACHABLE`, 24 `NOT_REACHABLE`,
and 12 `UNKNOWN`, across two intentionally vulnerable training applications
and four other open-source projects. The 12 new cases pin the
[RealWorld API](https://github.com/gothinkster/node-express-realworld-example-app)
and have advisory-specific source and version rationales. Ground-truth
`UNKNOWN` cases are excluded from recall and precision. See the
[benchmark dataset](./bench/cases) and [benchmark methodology](./docs/benchmark.md).

<!-- reachfix-benchmark:start -->

## Benchmark results

> Only manually reviewed runs with at least 50 cases and 30% ground-truth REACHABLE cases are shown.

| Date       | Cases | Audit packages | Reachfix packages | Recall | Precision | Alert reduction | Fix success | Median time | Avg. API cost |
| ---------- | ----: | -------------: | ----------------: | -----: | --------: | --------------: | ----------: | ----------: | ------------: |
| 2026-10-18 |    65 |            451 |               262 | 100.0% |     66.7% |           41.9% |         n/a |     3483 ms |           n/a |

<!-- reachfix-benchmark:end -->

## Limitations

Reachability uses source-text heuristics, does not inspect dependency internals,
and can miss dynamic or unsupported constructs. A `NOT_REACHABLE` result is
not proof that an application is safe; review the evidence and the benchmark
limitations before relying on results. The optional LLM repair component exists
as a lower-level service, but neither the `fix` command nor GitHub Action calls
it; caller-code migrations are not automated. See
[limitations and result interpretation](./docs/limitations.md).

## Requirements

- Node.js 22 or later to run reachfix.
- Docker for dependency-fix verification.
- pnpm 11 is required only for development.

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

`scan --format` accepts `text`, `json`, `sarif`, or `markdown`. `--fail-on`
accepts `reachable` (default), `unknown`, `any`, or `never`. Exit codes are
`0` when the threshold is not met, `1` when it is met, and `2` for a tool
error. `fix` considers reachable findings only, selects a fixed version
reported by OSV, updates a temporary copy, and applies only package
manifest/lockfile changes after Docker verification against a clean baseline.
`fix --pr` also creates a branch, commits those files, pushes it, and opens a
pull request with GitHub CLI; it requires a clean Git worktree, `gh`
authentication, and `contents: write`/`pull-requests: write` permissions.

More detail: [architecture](./docs/architecture.md),
[development milestones](./docs/milestones.md),
[AI-assisted development and release process](./docs/ai-development-and-release.md),
and the [project specification](./SPEC.md).

## License

MIT
