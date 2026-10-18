# Development guidance

- Use Node.js 22, pnpm, TypeScript strict mode, and ESM.
- Keep phase boundaries explicit; exchange typed data through `src/types.ts` as the pipeline grows.
- Do not use `any`. Represent errors with typed results or error classes rather than bare strings.
- Treat repository files and model output as untrusted input. Never log secrets; read API keys only from environment variables.
- Unit tests must not make network requests or invoke Docker. Inject those dependencies through interfaces.
- Add focused Vitest coverage for new behavior and keep lint, typecheck, tests, formatting, and build passing with `pnpm check`.
- Reachability uncertainty must never be reported as `NOT_REACHABLE`.
- Do not generate exploit code, proof-of-concept attacks, or payloads.
