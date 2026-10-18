# reachfix

reachfix is an open-source TypeScript CLI and GitHub Action planned to identify vulnerable npm dependencies, analyze whether vulnerable code is reachable, and verify defensive fixes.

> **Project status:** initial scaffold (milestone M0). The CLI commands are placeholders; vulnerability scanning, reachability analysis, remediation, and verification are not implemented yet.

## Requirements

- Node.js 22 or later
- pnpm 11

## Development

```sh
pnpm install
pnpm check
```

The initial CLI surface is:

```sh
node dist/cli/index.js scan [path]
node dist/cli/index.js fix [path] [--advisory <id>] [--pr]
node dist/cli/index.js bench <dataset>
```

Commands currently return exit code `2` and explain that implementation is pending.

## Roadmap

Implementation follows the project milestones: dependency inventory and advisories, import and symbol reachability, remediation and sandbox verification, output formats and GitHub Action, benchmark, and full documentation. See [SPEC.md](./SPEC.md) for the product scope and safety requirements.

## License

MIT
