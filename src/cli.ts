import { parseArgs } from 'node:util';
import fs from 'node:fs';
import type { OvelappedConfig } from './types.js';
import { detectRunner } from './runner.js';
import { analyze } from './analyzer.js';
import { buildReport, writeReport, printSummary } from './reporter.js';
import { pruneTests } from './pruner.js';

const HELP = `\x1b[1movelapped\x1b[0m — find unit tests whose coverage is fully subsumed by integration tests

\x1b[1mUsage:\x1b[0m
  ovelapped analyze [options]    Run coverage analysis
  ovelapped prune   [options]    Remove redundant tests from source files

\x1b[1mOptions:\x1b[0m
  --runner <vitest|jest>          Test runner (auto-detected by default)
  --reference <name>              Reference suite project/config name
  --reference-coverage <path>     Path to a pre-generated coverage-final.json
  --unit <name>                   Unit test suite project/config name
  --include <glob>                Unit test file pattern (default: src/**/*.test.ts)
  --concurrency <n>               Parallel test runs (default: 8)
  --report <path>                 Report path (default: ovelapped-report.json)
  --dry-run                       Show what would be removed without modifying files
  --help                          Show this help
  --version                       Show version
`;

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      runner: { type: 'string' },
      reference: { type: 'string' },
      'reference-coverage': { type: 'string' },
      unit: { type: 'string' },
      include: { type: 'string', multiple: true },
      concurrency: { type: 'string' },
      report: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.version) {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    console.log(pkg.version);
    return;
  }

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const command = positionals[0];
  const cwd = process.cwd();

  const config: OvelappedConfig = {
    runner: (values.runner as 'vitest' | 'jest') ?? detectRunner(cwd),
    referenceProject: values.reference,
    referenceCoverage: values['reference-coverage'],
    unitProject: values.unit,
    unitInclude: values.include ?? ['src/**/*.test.ts'],
    concurrency: parseInt(values.concurrency ?? '8', 10),
    reportPath: values.report ?? 'ovelapped-report.json',
  };

  if (command === 'analyze') {
    runAnalyze(config, cwd);
  } else if (command === 'prune') {
    runPrune(config, values['dry-run'] ?? false);
  } else {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
  }
}

async function runAnalyze(
  config: OvelappedConfig,
  cwd: string,
): Promise<void> {
  try {
    const results = await analyze(config, cwd);
    const report = buildReport(results);
    writeReport(report, config.reportPath);
    printSummary(report);
    console.log(`\nReport written to ${config.reportPath}`);
  } catch (err) {
    console.error(`\n\x1b[31mError:\x1b[0m ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function runPrune(
  config: OvelappedConfig,
  dryRun: boolean,
): Promise<void> {
  if (!fs.existsSync(config.reportPath)) {
    console.error(
      `Report not found: ${config.reportPath}\nRun \`ovelapped analyze\` first.`,
    );
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(fs.readFileSync(config.reportPath, 'utf8'));

  const results = report.results.map(
    (r: {
      file: string;
      name: string;
      status: string;
      uniqueStatements: number;
      uniqueBranches: number;
    }) => ({
      test: {
        file: r.file,
        name: r.name,
        startOffset: 0,
        endOffset: 0,
        kind: 'test' as const,
      },
      status: r.status,
      uniqueStatements: r.uniqueStatements,
      uniqueBranches: r.uniqueBranches,
      totalStatements: 0,
      totalBranches: 0,
    }),
  );

  console.log(
    dryRun ? '\nDry run — no files will be modified:\n' : '\nPruning redundant tests:\n',
  );

  const { deletedFiles, editedFiles, totalTestsRemoved } = pruneTests(
    results,
    dryRun,
  );

  console.log(
    `\n${dryRun ? 'Would remove' : 'Removed'} ${totalTestsRemoved} tests (${deletedFiles.length} files deleted, ${editedFiles.length} files edited)`,
  );
}

main();
