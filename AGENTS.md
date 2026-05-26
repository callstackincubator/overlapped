# AGENTS.md

Minimal operating guide for AI coding agents in this repo.

## Toolchain
- TypeScript strict mode is enabled in `tsconfig.json`.
- ESM package: `"type": "module"`, `module: "NodeNext"`.
- Runtime baseline is Node >= 22.
- Build with `npx tsc` or the package script `npm run build`.
- Runtime dependency budget is zero. Do not add runtime dependencies.
- No linter or formatter is configured yet. Match the existing style.

## Code Style
- Surgical edits only. Keep changes scoped to the requested behavior.
- Match existing style and naming. Do not introduce broad refactors.
- Add comments only when the why is non-obvious.
- Target <= 300 LOC per source file when practical.
- Remove unused imports only from lines you touch or make unused.

## Architecture
- CLI entrypoint is `src/cli.ts`.
- Public API exports live in `src/index.ts`.
- Runner detection and execution live in `src/runner.ts`.
- Runner binaries must resolve from the target project's `node_modules/.bin/`.
- Coverage loading, fingerprinting, and subsumption checks live in `src/coverage.ts`.
- Test extraction in `src/extractor.ts` uses bracket/string matching, not an AST.
- Test pruning in `src/pruner.ts` uses string manipulation against source files.
- Reports are built, written, and printed by `src/reporter.ts`.
- Shared shapes live in `src/types.ts`.

## Testing
- There is no automated test suite yet.
- For docs-only changes, no validation is required.
- For TypeScript changes, run `npm run build`.
- For behavior changes, manually validate against a real project using Vitest or Jest:
  - `overlapped analyze --runner vitest ...`
  - `overlapped analyze --runner jest ...`
- Validate both runners when changing runner detection, runner command construction, coverage handling, extraction, or pruning.

## Hard Rules
- Keep zero runtime dependencies.
- Keep both Vitest and Jest supported.
- Never shell out through `npx` for test execution. Resolve runner binaries from `node_modules/.bin/`.
- Istanbul `coverage-final.json` is the only supported coverage format.
- Do not introduce AST parsing unless the project explicitly changes direction.
- Do not make pruning depend on formatter output.

## Key Files
- `bin/overlapped.mjs`: Node executable shim that imports the built CLI.
- `src/cli.ts`: argument parsing, command dispatch, analyze/prune orchestration.
- `src/index.ts`: public API barrel exports.
- `src/analyzer.ts`: coverage analysis pipeline and per-test subsumption checks.
- `src/runner.ts`: runner detection, binary resolution, coverage command construction.
- `src/coverage.ts`: Istanbul coverage loading and coverage fingerprint comparison.
- `src/extractor.ts`: test and `test.each` extraction via source text matching.
- `src/pruner.ts`: removal of subsumed tests or fully redundant files.
- `src/reporter.ts`: JSON report creation, writing, and console summary.
- `src/types.ts`: shared config, coverage, runner, test, and result types.

## Pull Requests
- Use conventional prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, `chore:`.
- Keep summaries short and scoped.
- Include what was validated, or state why validation was not run.
