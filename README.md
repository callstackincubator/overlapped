<p align="center">
  <a href="https://callstack.com/open-source/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme">
    <img alt="ovelapped" src="https://callstack.com/images/open-source/callstack-open-source.svg" width="300" />
  </a>
</p>

---

# ovelapped

Find unit tests whose coverage is fully subsumed by integration tests.

Find the unit tests your AI agent wrote twice.

## Overview

`ovelapped` analyzes your test suite to find unit tests that don't cover anything your integration tests don't already cover. It runs each unit test in isolation, compares its coverage fingerprint against a reference suite (e.g. integration or e2e tests), and reports which tests are redundant.

Supports **vitest** and **jest** out of the box — the runner is auto-detected from your project dependencies.

Use it when a test suite has grown in bulk, especially after AI-assisted test generation, and you want to keep only the tests that add coverage signal.

## Real-World Cleanup

In [callstackincubator/agent-device#595](https://github.com/callstackincubator/agent-device/pull/595), `ovelapped` was used to audit a large AI-assisted test suite against provider-integration coverage.

| Metric | Before | After |
|---|---:|---:|
| Unit tests | 1,831 | 1,723 |
| Redundant tests removed | — | 151 |
| Fully redundant files deleted | — | 8 |
| Files with individual tests removed | — | 54 |
| Test code removed | — | 2,598 lines |
| Statement coverage | 82.4% | 82.41% |
| Branch coverage | 71.94% | 71.96% |
| Line coverage | 84.49% | 84.5% |

The important bit: all removed tests covered only statements and branches already covered by integration tests. The suite got smaller without losing coverage.

## Quick Start

Compare default unit tests against a reference suite:

```bash
npx ovelapped analyze
```

This will:

1. Run your reference test suite with coverage
2. Discover and run each unit test in isolation
3. Compare coverage fingerprints at statement and branch level
4. Write a JSON report to `ovelapped-report.json`

To remove the redundant tests:

```bash
npx ovelapped prune --dry-run    # preview changes
npx ovelapped prune              # apply changes
```

For a Vitest workspace with named projects, like the agent-device cleanup:

```bash
npx ovelapped analyze \
  --runner vitest \
  --reference provider-integration \
  --unit unit \
  --include "src/**/*.test.ts"
```

Recommended cleanup loop:

1. Run `ovelapped analyze`.
2. Review `ovelapped-report.json`.
3. Run `ovelapped prune --dry-run`.
4. Apply with `ovelapped prune`.
5. Run your full test suite with coverage and confirm thresholds still pass.

## Prerequisites

- **Node.js >= 22**
- **vitest** or **jest** installed in your project
- Coverage provider configured (e.g. `@vitest/coverage-v8` for vitest)

## Usage

### `ovelapped analyze`

Runs the full analysis. By default it executes your reference suite to generate coverage, then runs each discovered unit test individually.

Use `--reference` for the integration, e2e, or provider suite that should act as the coverage baseline. Use `--unit` for the suite containing candidate tests to remove.

If you already have a `coverage-final.json` from a prior run, skip the reference suite:

```bash
ovelapped analyze --reference-coverage ./coverage/coverage-final.json
```

### `ovelapped prune`

Reads the analysis report and removes subsumed tests from source files. Files where all tests are subsumed are deleted entirely; files with a mix get individual test blocks removed.

Always review changes with `--dry-run` first.

## Options

| Option | Description | Default |
|---|---|---|
| `--runner <vitest\|jest>` | Test runner | auto-detected |
| `--reference <name>` | Reference suite project or config name | — |
| `--reference-coverage <path>` | Path to existing `coverage-final.json` | — |
| `--unit <name>` | Unit test suite project or config name | — |
| `--include <glob>` | Unit test file pattern (repeatable) | `src/**/*.test.ts` |
| `--concurrency <n>` | Parallel test runs | `8` |
| `--report <path>` | Report output path | `ovelapped-report.json` |
| `--dry-run` | Preview prune without modifying files | `false` |

## How It Works

1. **Reference fingerprint** — Runs (or loads) coverage for the reference suite. Each covered statement and branch becomes a key in a `Set<string>` (e.g. `"/src/foo.ts:s:3"`, `"/src/foo.ts:b:1:0"`).
2. **Per-test fingerprint** — Runs each unit test in isolation with coverage, building the same fingerprint.
3. **Subsumption check** — If every key in a test's fingerprint exists in the reference fingerprint, the test is *subsumed* — it exercises no code path that the reference suite doesn't already cover.
4. **Pruning** — Removes subsumed test blocks from source files using bracket-matching (no AST required).

## License

MIT

## Made at Callstack

`ovelapped` is an open source project and will always remain free to use. The project has been developed in close partnership with [Callstack](https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme), and contributed to the React Native Community.

Callstack is a group of React and React Native experts. If you need help with these or want to say hi, contact us at [callstack.com](https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme).

Like the project? [Join the Callstack team](https://callstack.com/careers/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme) who does amazing stuff for clients and drives React Native Open Source!
