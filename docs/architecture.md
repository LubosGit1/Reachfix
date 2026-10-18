# Architecture

reachfix is a Node.js 22+ TypeScript CLI and composite GitHub Action. Its scan
pipeline is intentionally separated into stages:

```text
project directory
  -> lockfile inventory
  -> OSV.dev advisory lookup and version filtering
  -> import and call-site heuristics
  -> scan findings
  -> terminal, JSON, Markdown, or SARIF output
```

## Scan pipeline

1. **Inventory** — [`src/inventory/lockfile-parser.ts`](../src/inventory/lockfile-parser.ts)
   reads npm `package-lock.json` v2/v3 or a pnpm lockfile and produces typed
   dependency records. It does not install dependencies.
2. **Advisories** — [`src/advisories/osv-client.ts`](../src/advisories/osv-client.ts)
   batches OSV.dev queries for dependency versions, validates responses,
   filters advisories against affected ranges, and caches successful results
   locally for 24 hours by default.
3. **Reachability** — [`src/reachability/call-path-analyzer.ts`](../src/reachability/call-path-analyzer.ts)
   checks project source for imported symbols and apparent calls.
   [`src/reachability/import-analyzer.ts`](../src/reachability/import-analyzer.ts)
   looks for literal imports, requires, re-exports, and dynamic usage. The
   coordinator in [`src/cli/scan.ts`](../src/cli/scan.ts) combines their
   evidence and conservatively marks relevant unanalysed transitive or
   re-exported paths `UNKNOWN`.
4. **Output and exit status** — [`src/cli/program.ts`](../src/cli/program.ts)
   exposes scan formats and failure thresholds. Report serializers live in
   [`src/report/`](../src/report/).

The source analyzers are lightweight heuristics, not a JavaScript runtime,
complete parser, or whole-program dataflow engine. Their evidence and limits
are described in [Limitations and interpreting results](./limitations.md).

## Remediation components

The repository contains a deterministic upgrade planner,
[`src/fix/upgrade-planner.ts`](../src/fix/upgrade-planner.ts), a constrained
context builder, and an optional Anthropic client and repair loop. Model
responses are schema-validated and patches are restricted to approved files.
[`src/verify/sandbox.ts`](../src/verify/sandbox.ts) provides an injected,
Docker-backed baseline/candidate verifier. It installs dependencies with
lifecycle scripts disabled, then runs test/build checks in a resource-limited,
network-isolated container. The repair loop captures and passes a clean
baseline snapshot to its injected verifier. The `fix` CLI command and Action
are not yet wired to this verifier, so both still decline automatic fixes.

## GitHub Action

[`action.yml`](../action.yml) builds the action, scans the selected project,
uploads SARIF, then applies the configured failure threshold. An analysis
threshold failure does not prevent SARIF upload; an operational tool error
does. The example workflow is in
[`examples/reachfix.yml`](../examples/reachfix.yml).

## Benchmark pipeline

The benchmark runner loads human-authored cases, checks out each public GitHub
repository at its immutable commit, scans it, and runs `npm audit` with scripts
disabled. It stores dated JSON under `bench/results/`. The report command
regenerates the marked README table. See the benchmark instructions and metric
definitions in the [README](../README.md#benchmark-m7) and
[limitations](./limitations.md#benchmark-results).
