# Benchmark methodology

Benchmark cases are manually labeled for a specific repository commit and OSV
advisory. Every case pins a public repository to an immutable 40-character
commit SHA, records the advisory ID and expected verdict, and explains the
ground truth with source and advisory evidence. Analyzer output is not ground
truth. `UNKNOWN` is the template default and should be retained when evidence
does not support either `REACHABLE` or `NOT_REACHABLE`.

## Adding cases

Create a template with:

```sh
pnpm bench:case -- <case-id>
```

Edit the generated JSON in `bench/cases/`. The loader accepts individual case
files and JSON arrays for curated bundles. Use sources pinned to the recorded
commit and the authoritative advisory text; label whether the advisory's
affected API or relevant configuration is used by that application. For
transitive dependencies whose use inside `node_modules` cannot be inspected,
do not infer `NOT_REACHABLE`.

Run the full dataset with:

```sh
pnpm bench bench/cases
```

Each case checks out its pinned commit without running repository scripts,
scans it statically, and obtains the comparison count from
`npm audit --json --package-lock-only --ignore-scripts`. The generated result
is written to `bench/results/<UTC-date>.json` using create-only semantics;
run at a different UTC date to avoid overwriting an existing report. The
README result table is rendered from checked-in result files with
`pnpm bench:report`.

## Metrics

- **Recall** uses only ground-truth `REACHABLE` cases. Predictions of
  `REACHABLE` or `UNKNOWN` preserve recall; `NOT_REACHABLE` does not.
- **Precision** uses only predictions of `REACHABLE`; a prediction is correct
  only when its ground truth is `REACHABLE`. Ground-truth `UNKNOWN` cases are
  excluded from both recall and precision.
- **Alert reduction** compares unique vulnerable package names reported by
  each tool for each pinned repository commit. Repeated advisory cases for a
  commit contribute package counts once; reachfix `UNKNOWN` findings count as
  alerts because the scanner reports them.
- **Median time** is the median scan duration per case. **Average API cost** is
  `n/a` because the benchmark does not measure API cost. Fix-success metrics
  are not representative until verified fix attempts are part of benchmark
  runs.

Results are withheld from the README unless a run has at least 50 cases and
at least 30% ground-truth `REACHABLE` cases. These thresholds do not make a
small, biased, or repository-concentrated sample representative of general
npm projects.
