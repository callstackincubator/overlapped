import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult, OverlappedConfig, TestEntry } from './types.js';
import {
  loadCoverageMap,
  loadCoverageFile,
  buildFingerprint,
  checkSubsumption,
} from './coverage.js';
import { extractTests } from './extractor.js';
import { runCommand, runCoverage } from './runner.js';

export async function analyze(
  config: OverlappedConfig,
  cwd: string,
): Promise<AnalysisResult[]> {
  // Phase 1: Load or generate reference coverage
  let refFp: Set<string>;

  if (config.referenceCommand) {
    const refCoverageDir = path.join(cwd, '.overlapped', 'reference');
    fs.mkdirSync(refCoverageDir, { recursive: true });

    process.stderr.write('Running reference command with coverage...\n');
    const refRun = await runCommand(config.referenceCommand, cwd, {
      OVERLAPPED_COVERAGE_DIR: refCoverageDir,
    });

    if (!refRun.ok) {
      throw new Error(
        'Reference command failed.\n\n' +
          `Command attempted:\n  ${refRun.command}\n\n` +
          referenceCommandHint(refCoverageDir, config.referenceCoverage, refRun.stderr),
      );
    }

    const refCoverageFile = findReferenceCoverageFile(
      cwd,
      refCoverageDir,
      config.referenceCoverage,
    );

    if (!refCoverageFile) {
      throw new Error(
        'Reference command did not produce coverage.\n\n' +
          `Command attempted:\n  ${refRun.command}\n\n` +
          referenceCommandHint(refCoverageDir, config.referenceCoverage, refRun.stderr),
      );
    }

    const refMap = loadCoverageFile(refCoverageFile);
    refFp = buildFingerprint(refMap);
  } else if (config.referenceCoverage) {
    process.stderr.write('Loading reference coverage...\n');
    const refMap = loadCoverageFile(path.resolve(cwd, config.referenceCoverage));
    refFp = buildFingerprint(refMap);
  } else {
    const refCoverageDir = path.join(cwd, '.overlapped', 'reference');
    fs.mkdirSync(refCoverageDir, { recursive: true });

    process.stderr.write('Running reference suite with coverage...\n');
    const refRun = await runCoverage({
      runner: config.runner,
      cwd,
      coverageDir: refCoverageDir,
      project: config.referenceProject,
    });

    if (!refRun.ok) {
      throw new Error(
        'Reference suite did not produce coverage.\n\n' +
          `Command attempted:\n  ${refRun.command}\n\n` +
          `Expected coverage file:\n  ${refRun.coverageFile}\n\n` +
          coverageFailureHint(config.referenceProject, config.runner, refRun.stderr),
      );
    }

    const refMap = loadCoverageMap(refCoverageDir);
    refFp = buildFingerprint(refMap);
  }

  const refStmts = [...refFp].filter((k) => k.includes(':s:')).length;
  const refBranches = [...refFp].filter((k) => k.includes(':b:')).length;
  process.stderr.write(
    `  Reference: ${refStmts} statements, ${refBranches} branches covered.\n`,
  );

  // Phase 2: Discover unit tests
  process.stderr.write('\nDiscovering unit tests...\n');

  const testFiles = findTestFiles(cwd, config.unitInclude);
  if (testFiles.length === 0) {
    throw new Error(
      `No test files found matching: ${config.unitInclude.join(', ')}\n` +
        'Use --include to specify a different pattern.',
    );
  }

  const allTests: TestEntry[] = [];
  for (const file of testFiles) {
    const tests = extractTests(file);
    allTests.push(...tests);
  }

  if (allTests.length === 0) {
    throw new Error(
      `Found ${testFiles.length} test files but no test() or it() calls inside them.`,
    );
  }

  process.stderr.write(
    `  Found ${allTests.length} tests in ${testFiles.length} files.\n\n`,
  );

  // Phase 3: Per-test analysis
  const results: AnalysisResult[] = [];
  const concurrency = config.concurrency;

  for (let i = 0; i < allTests.length; i += concurrency) {
    const batch = allTests.slice(i, i + concurrency);
    const promises = batch.map(async (test, batchIdx) => {
      const idx = i + batchIdx;
      const covDir = path.join(cwd, '.overlapped', `test-${idx}`);
      fs.mkdirSync(covDir, { recursive: true });

      try {
        const run = await runCoverage({
          runner: config.runner,
          cwd,
          coverageDir: covDir,
          project: config.unitProject,
          testFile: path.relative(cwd, test.file),
          testNamePattern: test.name,
          timeout: 60_000,
        });

        if (!run.ok) {
          return {
            test,
            status: 'error' as const,
            uniqueStatements: 0,
            uniqueBranches: 0,
            totalStatements: 0,
            totalBranches: 0,
            error: `No coverage produced. Command attempted: ${run.command}`,
          };
        }

        const testMap = loadCoverageMap(covDir);
        const testFp = buildFingerprint(testMap);
        const { subsumed, uniqueStatements, uniqueBranches } =
          checkSubsumption(testFp, refFp);

        const totalStatements = [...testFp].filter((k) =>
          k.includes(':s:'),
        ).length;
        const totalBranches = [...testFp].filter((k) =>
          k.includes(':b:'),
        ).length;

        return {
          test,
          status: subsumed ? ('subsumed' as const) : ('unique' as const),
          uniqueStatements,
          uniqueBranches,
          totalStatements,
          totalBranches,
        };
      } finally {
        fs.rmSync(covDir, { recursive: true, force: true });
      }
    });

    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      results.push(r);
      const idx = results.length;
      const shortName =
        r.test.name.length > 55
          ? r.test.name.slice(0, 52) + '...'
          : r.test.name;
      const fileBase = path.basename(r.test.file);
      const status =
        r.status === 'subsumed'
          ? '\x1b[33msubsumed\x1b[0m'
          : r.status === 'error'
            ? '\x1b[31merror\x1b[0m'
            : `\x1b[32munique\x1b[0m (${r.uniqueStatements}s/${r.uniqueBranches}b)`;
      process.stderr.write(
        `  [${String(idx).padStart(String(allTests.length).length)}/${allTests.length}] ${status}  ${fileBase} > ${shortName}\n`,
      );
    }
  }

  // Cleanup
  fs.rmSync(path.join(cwd, '.overlapped'), { recursive: true, force: true });

  return results;
}

function findReferenceCoverageFile(
  cwd: string,
  refCoverageDir: string,
  configuredPath: string | undefined,
): string | null {
  const candidates = configuredPath
    ? [path.resolve(cwd, configuredPath)]
    : [
        path.join(refCoverageDir, 'coverage-final.json'),
        path.join(cwd, 'coverage', 'coverage-final.json'),
      ];

  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

function referenceCommandHint(
  refCoverageDir: string,
  configuredPath: string | undefined,
  stderr: string,
): string {
  const expected = configuredPath
    ? [`  ${configuredPath}`]
    : [
        `  ${path.join(refCoverageDir, 'coverage-final.json')}`,
        '  coverage/coverage-final.json',
      ];
  const lines = [
    'Expected coverage file:',
    ...expected,
    '',
    'When using --reference-command, either:',
    '  - write coverage to $OVERLAPPED_COVERAGE_DIR/coverage-final.json',
    '  - or pass --reference-coverage <path> pointing at the command output',
  ];

  if (stderr.trim()) {
    lines.push('', 'Runner stderr:', indent(stderr.trim()));
  }

  return lines.join('\n');
}

function coverageFailureHint(
  referenceProject: string | undefined,
  runner: string,
  stderr: string,
): string {
  const lines = [
    `${runner} was found and overlapped did pass coverage flags.`,
    'The command either failed before writing coverage, or the runner wrote coverage somewhere else.',
    '',
    'Common fixes:',
  ];

  if (!referenceProject) {
    lines.push(
      '  - Pass the suite to use as the baseline, for example: --reference integration',
      '  - Or skip running the reference suite with: --reference-coverage ./coverage/coverage-final.json',
    );
  }

  if (stderr.includes('BaseCoverageProvider')) {
    lines.push(
      '  - Your Vitest coverage provider appears to be version-mismatched.',
      '    Keep vitest and @vitest/coverage-v8 on the same major version.',
    );
  }

  lines.push(
    '  - For Vitest, install/configure a coverage provider such as @vitest/coverage-v8.',
    '  - For Jest, make sure coverage can run and produce coverage-final.json.',
    '  - Run the command above directly to see the full runner failure.',
  );

  if (stderr.trim()) {
    lines.push('', 'Runner stderr:', indent(stderr.trim()));
  }

  return lines.join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .slice(-12)
    .map((line) => `  ${line}`)
    .join('\n');
}

function findTestFiles(cwd: string, patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    const found = fs.globSync(pattern, { cwd });
    files.push(...found.map((f) => path.join(cwd, f)));
  }
  return [...new Set(files)].sort();
}
