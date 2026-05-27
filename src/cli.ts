import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult, OverlappedConfig } from './types.js';
import { detectRunner } from './runner.js';
import { analyze } from './analyzer.js';
import { buildReport, writeReport, printSummary } from './reporter.js';
import { pruneTests } from './pruner.js';

const DEFAULT_UNIT_INCLUDE: string[] = [];

const DEFAULT_UNIT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.overlapped/**',
  '**/*.integration.test.ts',
  '**/*.integration.test.tsx',
  '**/*.integration.test.js',
  '**/*.integration.test.jsx',
  '**/*.integration.spec.ts',
  '**/*.integration.spec.tsx',
  '**/*.integration.spec.js',
  '**/*.integration.spec.jsx',
  '**/*.e2e.test.ts',
  '**/*.e2e.test.tsx',
  '**/*.e2e.test.js',
  '**/*.e2e.test.jsx',
  '**/*.e2e.spec.ts',
  '**/*.e2e.spec.tsx',
  '**/*.e2e.spec.js',
  '**/*.e2e.spec.jsx',
];

const HELP = `\x1b[1moverlapped\x1b[0m — find unit tests with 100% statement/branch overlap

\x1b[1mUsage:\x1b[0m
  overlapped analyze [options]    Run coverage analysis
  overlapped prune   [options]    Remove reported overlap candidates from source files

\x1b[1mOptions:\x1b[0m
  --runner <vitest|jest>          Test runner (auto-detected by default)
  --reference <name>              Reference suite project name
  --reference-command <command>   Command that generates reference coverage
  --reference-coverage <path>     Path to a pre-generated coverage-final.json
  --unit <name>                   Unit test suite project name
  --include <glob>                Unit test file pattern (repeatable)
  --exclude <glob>                Unit test file pattern to exclude
  --concurrency <n>               Parallel test runs (default: 8)
  --report <path>                 Report path (default: overlapped-report.json)
  --dry-run                       Show what would be removed without modifying files
  --help                          Show this help
  --version                       Show version
`;

function main(): void {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        runner: { type: 'string' },
        reference: { type: 'string' },
        'reference-command': { type: 'string' },
        'reference-coverage': { type: 'string' },
        unit: { type: 'string' },
        include: { type: 'string', multiple: true },
        exclude: { type: 'string', multiple: true },
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

    if (command === 'analyze') {
      runAnalyze(buildConfig(values, cwd), cwd);
    } else if (command === 'prune') {
      runPrune(
        {
          reportPath: values.report ?? 'overlapped-report.json',
        },
        values['dry-run'] ?? false,
      );
    } else {
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
    }
  } catch (err) {
    printError(err as Error);
    process.exitCode = 1;
  }
}

function buildConfig(
  values: {
    runner?: string;
    reference?: string;
    'reference-command'?: string;
    'reference-coverage'?: string;
    unit?: string;
    include?: string[];
    exclude?: string[];
    concurrency?: string;
    report?: string;
  },
  cwd: string,
): OverlappedConfig {
  const runner = parseRunner(values.runner, cwd);
  const scripts = readPackageScripts(cwd);
  const referenceCommand =
    values['reference-command'] ??
    inferReferenceCommand(
      scripts,
      runner,
      values.reference,
      values['reference-coverage'],
    );
  const referenceCommandSource: OverlappedConfig['referenceCommandSource'] =
    values['reference-command']
      ? '--reference-command'
      : referenceCommand
        ? 'test:integration'
        : undefined;

  const config = {
    runner,
    referenceProject: values.reference,
    referenceCommand,
    referenceCommandSource,
    referenceCoverage: values['reference-coverage'],
    unitProject: values.unit,
    unitInclude: values.include ?? DEFAULT_UNIT_INCLUDE,
    unitExclude: values.exclude ?? DEFAULT_UNIT_EXCLUDE,
    concurrency: parseInt(values.concurrency ?? '8', 10),
    reportPath: values.report ?? 'overlapped-report.json',
  };

  validateConfig(config);
  return config;
}

function readPackageScripts(cwd: string): Record<string, string> {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.scripts ?? {};
}

function inferReferenceCommand(
  scripts: Record<string, string>,
  runner: 'vitest' | 'jest',
  referenceProject: string | undefined,
  referenceCoverage: string | undefined,
): string | undefined {
  if (referenceProject || referenceCoverage) return undefined;

  const script = scripts['test:integration'];
  if (!script) return undefined;

  const coverageArgs = runner === 'vitest'
    ? [
        '--coverage',
        '--coverage.reporter=json',
        '--coverage.all=false',
        '--coverage.thresholds.lines=0',
        '--coverage.thresholds.statements=0',
        '--coverage.reportOnFailure',
      ]
    : [
        '--coverage',
        '--coverageReporters=json',
        '--forceExit',
      ];

  return `${script} ${coverageArgs.join(' ')}`;
}

function validateConfig(config: OverlappedConfig): void {
  if (
    !config.referenceProject &&
    !config.referenceCommand &&
    !config.referenceCoverage
  ) {
    throw new Error(
      'Reference suite is required.\n\n' +
        'Running without a reference would compare candidate tests against a suite that may include those same tests, producing false positives.\n\n' +
        'Use one of these:\n' +
        '  overlapped analyze --reference <project-or-config>\n' +
        '  overlapped analyze --reference-command "npm run test:coverage"\n' +
        '  overlapped analyze --reference-coverage ./coverage/coverage-final.json',
    );
  }

  if (config.referenceProject && config.referenceCommand) {
    throw new Error(
      'Use either --reference or --reference-command, not both.',
    );
  }
}

function parseRunner(value: string | undefined, cwd: string): 'vitest' | 'jest' {
  if (value === 'vitest' || value === 'jest') return value;
  if (value) {
    throw new Error(
      `Unsupported runner: ${value}\nPass --runner vitest or --runner jest.`,
    );
  }
  return detectRunner(cwd);
}

function printError(err: Error): void {
  console.error(`\n\x1b[31mError:\x1b[0m ${err.message}`);
}

async function runAnalyze(
  config: OverlappedConfig,
  cwd: string,
): Promise<void> {
  try {
    const results = await analyze(config, cwd);
    const report = buildReport(results);
    writeReport(report, config.reportPath);
    printSummary(report);
    console.log(`\nReport written to ${config.reportPath}`);
  } catch (err) {
    printError(err as Error);
    process.exitCode = 1;
  }
}

async function runPrune(
  config: Pick<OverlappedConfig, 'reportPath'>,
  dryRun: boolean,
): Promise<void> {
  if (!fs.existsSync(config.reportPath)) {
    console.error(
      `Report not found: ${config.reportPath}\nRun \`overlapped analyze\` first.`,
    );
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(fs.readFileSync(config.reportPath, 'utf8'));

  const results = report.results.map(
    (r: {
      file: string;
      name: string;
      status: AnalysisResult['status'];
      uniqueStatements: number;
      uniqueBranches: number;
    }): AnalysisResult => ({
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
    dryRun
      ? '\nDry run — no files will be modified:\n'
      : '\nPruning reported overlap candidates:\n',
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
