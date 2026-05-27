# overlapped

Find the unit tests your AI agent wrote twice.

## Quick Start

1. Split your test scripts into unit tests and integration tests:

```json
{
  "scripts": {
    "test:unit": "vitest run src",
    "test:integration": "vitest run test/integration"
  }
}
```

`overlapped` uses the exact `test:integration` script as the integration baseline. The `test:unit` script keeps the split obvious for humans and CI; candidate unit tests are discovered from common `*.test.ts` and `*.spec.ts` files.

2. Run the analyzer:

```bash
overlapped analyze
```

Example output:

```text
=== overlapped ===

Total tests analyzed: 312
100% overlapped candidates: 27
Tests with unique coverage: 285

Files where every test is a removal candidate (2):
  src/__tests__/legacy-client.test.ts
  src/utils/__tests__/formatters.test.ts

Files with removal candidates (6):
  src/__tests__/client.test.ts: 5 candidates, 12 with unique coverage
  src/core/__tests__/validation.test.ts: 3 candidates, 9 with unique coverage

Report written to overlapped-report.json
```

Review `overlapped-report.json`, then preview removals:

```bash
npx overlapped prune --dry-run
```

Apply the cleanup when the preview looks right:

```bash
npx overlapped prune
```

Then run your full test suite with coverage and confirm thresholds still pass.

`overlapped analyze` discovers candidate unit tests from Jest/Vitest-style `*.test.*` and `*.spec.*` files, excluding `.integration.*` and `.e2e.*` files.

Treat the report as a review queue, not an instruction to delete blindly. A test can have a fully overlapped or empty coverage fingerprint and still protect a useful contract, such as package exports, config shape, generated files, or release metadata.

## Overview

`overlapped` finds unit tests whose statement and branch coverage is 100% overlapped by a baseline suite, usually integration, e2e, or provider tests.

It runs each candidate unit test in isolation, compares its statement and branch coverage against the baseline coverage, and reports tests that are candidates to remove.

In the CLI, that baseline is called the **reference suite** because it can be integration tests, e2e tests, provider tests, or an existing Istanbul `coverage-final.json`.

Use it when a test suite has grown in bulk, especially after AI-assisted test generation, and you want to keep the tests that still carry signal.

Supports **Vitest** and **Jest** out of the box. The runner is auto-detected from your project dependencies.

## Real-World Cleanup

In [callstackincubator/agent-device#595](https://github.com/callstackincubator/agent-device/pull/595), `overlapped` audited a large AI-assisted unit suite against provider-integration coverage.

| Metric | Before | After |
|---|---:|---:|
| Unit tests | 1,831 | 1,723 |
| 100% overlapped tests removed | — | 151 |
| Fully overlapped files deleted | — | 8 |
| Files with individual tests removed | — | 54 |
| Test code removed | — | 2,598 lines |
| Statement coverage | 82.4% | 82.41% |
| Branch coverage | 71.94% | 71.96% |
| Line coverage | 84.49% | 84.5% |

Every removed test covered only statements and branches that the integration suite already covered. The report identified candidates; humans still reviewed whether any test guarded a contract that coverage could not see.

## Common Setups

Vitest or Jest workspace with named projects, like the agent-device cleanup:

```bash
npx overlapped analyze \
  --runner vitest \
  --reference provider-integration \
  --unit unit \
  --include "src/**/*.test.ts"
```

No project setup, but custom file layout:

```bash
npx overlapped analyze \
  --include "packages/*/src/**/*.test.ts" \
  --exclude "packages/*/src/**/*.integration.test.ts"
```

Existing integration coverage:

```bash
npx overlapped analyze \
  --reference-coverage ./coverage/coverage-final.json
```

pnpm monorepo or custom baseline script:

```bash
npx overlapped analyze \
  --reference-command 'pnpm vitest run "test/**/*.integration.test.ts" --coverage --coverage.reporter=json' \
  --include "test/**/*.test.ts"
```

If your package has an exact `test:integration` script, `overlapped analyze` uses it automatically as the integration baseline. Similar-looking names such as `test-integration` or `test:e2e` are not guessed.

If your script writes coverage to a fixed path, point `overlapped` at it:

```bash
npx overlapped analyze \
  --reference-command "npm run test:coverage" \
  --reference-coverage ./coverage/integration/coverage-final.json \
  --include "test/**/*.test.ts"
```

## Prerequisites

- **Node.js >= 22**
- **Vitest** or **Jest** installed in your project
- Coverage provider configured (e.g. `@vitest/coverage-v8` for Vitest)
- For Vitest, keep `vitest` and `@vitest/coverage-v8` on the same major version
- A baseline suite, such as integration or e2e tests, or an existing Istanbul `coverage-final.json`

`overlapped` does not call arbitrary npm scripts. It resolves the local runner binary from the current package or a parent workspace `node_modules/.bin/`, then runs it with coverage flags pointed at a temporary `.overlapped/` directory.

The exception is baseline coverage: `--reference-command`, or the exact `test:integration` script convention, is only for generating baseline coverage. Per-test analysis still uses the local Vitest or Jest binary directly so `overlapped` can run one test file and one test name at a time.

## Usage

### `overlapped analyze`

Builds the overlap report. A baseline is required: use `--reference`, `--reference-command`, or `--reference-coverage` for the suite that acts as the coverage baseline. Use `--unit` for the suite containing candidate tests to inspect.

### `overlapped prune`

Reads the report and removes reported overlap candidates. Files where every test is a candidate are deleted entirely; mixed files get individual test blocks removed.

Always review changes with `--dry-run` first.

## Options

| Option | Description | Default |
|---|---|---|
| `--runner <vitest\|jest>` | Test runner | auto-detected |
| `--reference <name>` | Reference suite project name | — |
| `--reference-command <command>` | Command that generates reference coverage | — |
| `--reference-coverage <path>` | Path to existing `coverage-final.json` | — |
| `--unit <name>` | Unit test suite project name | — |
| `--include <glob>` | Unit test file pattern (repeatable) | Jest/Vitest-style `*.test.*` and `*.spec.*` files |
| `--exclude <glob>` | Unit test file pattern to exclude | common `.integration.*` and `.e2e.*` patterns |
| `--concurrency <n>` | Parallel test runs | `8` |
| `--report <path>` | Report output path | `overlapped-report.json` |
| `--dry-run` | Preview prune without modifying files | `false` |

## How It Works

1. Runs or loads Istanbul `coverage-final.json` for the baseline suite.
2. Runs each candidate unit test in isolation with coverage.
3. Turns covered statements and branches into fingerprint keys, such as `"/src/foo.ts:s:3"` and `"/src/foo.ts:b:1:0"`.
4. Marks a test as a removal candidate only when every key in its fingerprint already exists in the baseline fingerprint.
5. Removes candidate test blocks with bracket matching. No AST, no runtime dependencies.

## License

MIT

## Made at Callstack

`overlapped` is an open source project and will always remain free to use. The project has been developed in close partnership with [Callstack](https://callstack.com/), and contributed to the React Native Community.

Callstack is a group of React and React Native experts. If you need help with these or want to say hi, contact us at [callstack.com](https://callstack.com/).

Like the project? [Join the Callstack team](https://callstack.com/careers/) who does amazing stuff for clients and drives React Native Open Source!
