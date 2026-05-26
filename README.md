# ovelapped

Find the unit tests your AI agent wrote twice.

## Overview

`ovelapped` finds unit tests that add no coverage beyond a reference suite, such as integration, e2e, or provider tests.

It runs each candidate unit test in isolation, compares its statement and branch coverage against the reference coverage, and reports tests that cover nothing new.

Use it when a test suite has grown in bulk, especially after AI-assisted test generation, and you want to keep the tests that still carry signal.

Supports **vitest** and **jest** out of the box. The runner is auto-detected from your project dependencies.

## Real-World Cleanup

In [callstackincubator/agent-device#595](https://github.com/callstackincubator/agent-device/pull/595), `ovelapped` audited a large AI-assisted unit suite against provider-integration coverage.

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

Every removed test covered only statements and branches that the integration suite already covered. Smaller suite, same coverage signal.

## Quick Start

Compare a unit suite against the suite that already gives you confidence:

```bash
npx ovelapped analyze \
  --reference integration \
  --unit unit \
  --include "src/**/*.test.ts"
```

Review `ovelapped-report.json`, then preview removals:

```bash
npx ovelapped prune --dry-run
```

Apply the cleanup when the preview looks right:

```bash
npx ovelapped prune
```

Then run your full test suite with coverage and confirm thresholds still pass.

## Common Setups

Vitest workspace with named projects, like the agent-device cleanup:

```bash
npx ovelapped analyze \
  --runner vitest \
  --reference provider-integration \
  --unit unit \
  --include "src/**/*.test.ts"
```

Existing reference coverage:

```bash
npx ovelapped analyze \
  --reference-coverage ./coverage/coverage-final.json
```

## Prerequisites

- **Node.js >= 22**
- **vitest** or **jest** installed in your project
- Coverage provider configured (e.g. `@vitest/coverage-v8` for vitest)

## Usage

### `ovelapped analyze`

Builds the redundancy report. Use `--reference` for the suite that acts as the coverage baseline, and `--unit` for the suite containing candidate tests to remove.

### `ovelapped prune`

Reads the report and removes redundant tests. Files where every test is redundant are deleted entirely; mixed files get individual test blocks removed.

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

1. Runs or loads Istanbul `coverage-final.json` for the reference suite.
2. Runs each candidate unit test in isolation with coverage.
3. Turns covered statements and branches into fingerprint keys, such as `"/src/foo.ts:s:3"` and `"/src/foo.ts:b:1:0"`.
4. Marks a test redundant only when every key in its fingerprint already exists in the reference fingerprint.
5. Removes redundant test blocks with bracket matching. No AST, no runtime dependencies, no guesswork.

## License

MIT

## Made at Callstack

`ovelapped` is an open source project and will always remain free to use. The project has been developed in close partnership with [Callstack](https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme), and contributed to the React Native Community.

Callstack is a group of React and React Native experts. If you need help with these or want to say hi, contact us at [callstack.com](https://callstack.com/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme).

Like the project? [Join the Callstack team](https://callstack.com/careers/?utm_source=github.com&utm_medium=referral&utm_campaign=ovelapped&utm_term=readme) who does amazing stuff for clients and drives React Native Open Source!
