# Limitations and interpreting results

reachfix is an early implementation, not a replacement for dependency
maintenance, code review, or a full security assessment. A clean or
`NOT_REACHABLE` result is not proof that an application is safe.

## Supported inputs

- Node.js 22 or later.
- npm `package-lock.json` version 2 or 3, and pnpm lockfiles supported by the
  installed parser.
- JavaScript and TypeScript source extensions `.js`, `.jsx`, `.mjs`, `.cjs`,
  `.ts`, `.tsx`, `.mts`, and `.cts`.
- Advisory data from OSV.dev.

Yarn lockfiles, monorepo workspace semantics, other ecosystems, runtime
behavior, fuzzing, and zero-day vulnerability discovery are out of scope.

## Reachability verdicts

- **`REACHABLE`** means the source heuristics found a matching import or an
  apparent call to an imported symbol. It does not prove that the code executes
  in production or that the vulnerable code path is invoked.
- **`NOT_REACHABLE`** means the current heuristics found no relevant use in the
  scanned application source. The result is limited by dynamic module loading,
  aliases, reflection, generated code, unsupported syntax, and the analysis
  boundary at `node_modules`.
- **`UNKNOWN`** means available evidence is insufficient. Dynamic/computed
  loading, re-exports, and transitive paths that the analyzer cannot inspect
  must not be treated as `NOT_REACHABLE`.

The scanner does not execute project code. Literal imports, re-exports, and
symbol references are detected with source-text heuristics and can produce
false positives or miss constructs outside those heuristics. Always inspect
the finding and its evidence.

## Fix and verification status

The planner and LLM-assisted patch pipeline are building blocks, not a
production automated remediation command. `fix` is still a placeholder, the
GitHub Action rejects `fix: true`, and no patch is applied by those interfaces.
The current manifest-version check alone is not sufficient to verify a fix.
Docker-isolated dependency installation, baseline comparison, and test
verification are not implemented; do not infer that a fix has passed them.

## Benchmark results

Benchmark verdicts are manually labeled for a specific repository commit and
advisory. The author must record a rationale and verify ground truth
independently; reachfix output is not ground truth. The template is deliberately
`UNKNOWN`. No benchmark cases or scores are included until real cases are
curated and run.

The generated table reports:

- **Recall:** for ground-truth `REACHABLE` cases, the fraction not classified
  `NOT_REACHABLE`. An `UNKNOWN` prediction is therefore preserved for recall.
- **Precision:** correct `REACHABLE` predictions divided by all
  `REACHABLE` predictions. It is `n/a` if there are no such predictions.
- **Alert reduction:** `1 - reachfix findings / npm audit vulnerability
count`. It is `n/a` when npm audit reports zero vulnerabilities. This
  comparison is a count comparison, not proof that both tools identify
  equivalent advisories.
- **Median time:** median wall-clock duration of the benchmark case scans.
- **Average API cost:** currently zero because the benchmark does not call an
  LLM. Fix-success metrics are not representative until verified fix attempts
  are wired into benchmark runs.

Small, biased, or incorrectly labeled datasets can produce misleading
aggregates. Follow the README guidance for dataset size and reachable-case
coverage before making comparative claims.

## External services and data handling

Scans send dependency coordinates and versions to OSV.dev. The optional
LLM-assisted repair component sends only its constructed advisory, release
notes, type definitions, and selected call-site files to Anthropic; see
[AI-assisted development and release process](./ai-development-and-release.md)
for operational safeguards. Review repository contents and service policies
before enabling external requests.
