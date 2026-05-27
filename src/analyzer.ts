import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult, OverlappedConfig, TestEntry } from './types.js';
import {
  loadCoverageMap,
  loadCoverageFile,
  buildFingerprint,
  checkOverlap,
} from './coverage.js';
import { extractTests } from './extractor.js';
import { buildCoverageCommand, runCommand, runCoverage } from './runner.js';

const colorsEnabled = process.env.NO_COLOR === undefined;
const color = {
  bold: (text: string) => (colorsEnabled ? `\x1b[1m${text}\x1b[0m` : text),
  dim: (text: string) => (colorsEnabled ? `\x1b[2m${text}\x1b[0m` : text),
  green: (text: string) => (colorsEnabled ? `\x1b[32m${text}\x1b[0m` : text),
  yellow: (text: string) => (colorsEnabled ? `\x1b[33m${text}\x1b[0m` : text),
  red: (text: string) => (colorsEnabled ? `\x1b[31m${text}\x1b[0m` : text),
  cyan: (text: string) => (colorsEnabled ? `\x1b[36m${text}\x1b[0m` : text),
};

const DEFAULT_TEST_FILE_PATTERNS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.test.mts',
  '**/*.test.cts',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/*.spec.jsx',
  '**/*.spec.mts',
  '**/*.spec.cts',
  '**/*.spec.mjs',
  '**/*.spec.cjs',
];

export async function analyze(
  config: OverlappedConfig,
  cwd: string,
): Promise<AnalysisResult[]> {
  // Phase 1: Load or generate reference coverage
  let refFp: Set<string>;
  let refCoverageFileUsed: string;

  writeSection('1. Integration baseline');

  if (config.referenceCommand) {
    const refCoverageDir = path.join(cwd, '.overlapped', 'reference');
    fs.mkdirSync(refCoverageDir, { recursive: true });

    writeDetail('source', config.referenceCommandSource ?? 'reference command');
    writeCommand(config.referenceCommand, cwd);
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
    refCoverageFileUsed = refCoverageFile;
    refFp = buildFingerprint(refMap);
  } else if (config.referenceCoverage) {
    const referenceCoverageFile = path.resolve(cwd, config.referenceCoverage);
    writeDetail('source', '--reference-coverage');
    writeDetail('file', referenceCoverageFile);
    const refMap = loadCoverageFile(referenceCoverageFile);
    refCoverageFileUsed = referenceCoverageFile;
    refFp = buildFingerprint(refMap);
  } else {
    const refCoverageDir = path.join(cwd, '.overlapped', 'reference');
    fs.mkdirSync(refCoverageDir, { recursive: true });
    const command = buildCoverageCommand({
      runner: config.runner,
      cwd,
      coverageDir: refCoverageDir,
      project: config.referenceProject,
    });

    writeDetail('source', config.referenceProject ? '--reference project' : 'runner default');
    writeCommand(command, cwd);
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
    refCoverageFileUsed = path.join(refCoverageDir, 'coverage-final.json');
    refFp = buildFingerprint(refMap);
  }

  const refStmts = [...refFp].filter((k) => k.includes(':s:')).length;
  const refBranches = [...refFp].filter((k) => k.includes(':b:')).length;
  writeDetail(
    'coverage',
    `${color.green(`${refStmts}`)} statements, ${color.green(`${refBranches}`)} branch paths`,
  );
  writeDetail('coverage file', displayPath(refCoverageFileUsed, cwd));

  // Phase 2: Discover unit tests
  writeSection('2. Candidate unit tests');
  if (config.unitInclude.length > 0) {
    writeDetail('include', config.unitInclude.join(', '));
  }
  writeDetail('exclude', config.unitExclude.join(', '));

  const testFiles = findTestFiles(cwd, config.unitInclude, config.unitExclude);
  if (testFiles.length === 0) {
    const includeDescription = config.unitInclude.length > 0
      ? config.unitInclude.join(', ')
      : 'Jest/Vitest-style *.test.* and *.spec.* files';
    throw new Error(
      `No test files found matching: ${includeDescription}\n` +
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

  writeDetail(
    'found',
    `${color.green(`${allTests.length}`)} tests in ${color.green(`${testFiles.length}`)} files`,
  );

  // Phase 3: Per-test analysis
  const results: AnalysisResult[] = [];
  const concurrency = config.concurrency;
  const sampleTest = allTests[0]!;
  const unitCommandTemplate = buildCoverageCommand({
    runner: config.runner,
    cwd,
    coverageDir: path.join(cwd, '.overlapped', 'test-N'),
    project: config.unitProject,
    testFile: path.relative(cwd, sampleTest.file),
    testNamePattern: sampleTest.name,
    timeout: 60_000,
  });

  writeSection('3. Per-test coverage checks');
  writeDetail('concurrency', `${concurrency}`);
  writeDetail('unit source', config.unitProject ? '--unit project' : 'runner default');
  writeCommand(unitCommandTemplate, cwd, 'command template');
  writeDetail(
    'note',
    'each candidate swaps in its own test file, test name, and coverage directory',
  );
  process.stderr.write('\n');

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
        const { overlapped, uniqueStatements, uniqueBranches } =
          checkOverlap(testFp, refFp);

        const totalStatements = [...testFp].filter((k) =>
          k.includes(':s:'),
        ).length;
        const totalBranches = [...testFp].filter((k) =>
          k.includes(':b:'),
        ).length;

        return {
          test,
          status: overlapped ? ('overlapped' as const) : ('unique' as const),
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
        r.status === 'overlapped'
          ? color.yellow('overlapped')
          : r.status === 'error'
            ? color.red('error')
            : `${color.green('unique')} ${color.dim(`(${r.uniqueStatements}s/${r.uniqueBranches}b)`)}`;
      process.stderr.write(
        `  ${color.dim(`[${String(idx).padStart(String(allTests.length).length)}/${allTests.length}]`)} ${status}  ${color.cyan(fileBase)} ${color.dim('>')} ${shortName}\n`,
      );
    }
  }

  // Cleanup
  fs.rmSync(path.join(cwd, '.overlapped'), { recursive: true, force: true });

  return results;
}

function writeSection(title: string): void {
  process.stderr.write(`\n${color.bold(title)}\n`);
}

function writeDetail(label: string, value: string): void {
  process.stderr.write(`  ${color.dim(`${label}:`)} ${color.yellow(value)}\n`);
}

function writeCommand(command: string, cwd: string, label = 'command'): void {
  process.stderr.write(`  ${color.dim(`${label}:`)}\n`);
  for (const line of formatCommand(command, cwd)) {
    process.stderr.write(`    ${color.yellow(line)}\n`);
  }
}

function formatCommand(command: string, cwd: string): string[] {
  const relative = displayPath(command, cwd);
  return relative
    .replace(/ && /g, ' &&\n')
    .replace(/ (?=--[\w.-]+(?:=| |$))/g, '\n  ')
    .split('\n');
}

function displayPath(value: string, cwd: string): string {
  return value.replaceAll(`${cwd}/`, './').replaceAll(cwd, '.');
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
    'When using --reference-command:',
    '  - let the runner write coverage/coverage-final.json',
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

function findTestFiles(
  cwd: string,
  patterns: string[],
  excludePatterns: string[],
): string[] {
  const files: string[] = [];
  for (const pattern of patterns.length > 0 ? patterns : DEFAULT_TEST_FILE_PATTERNS) {
    const found = fs.globSync(pattern, { cwd });
    files.push(...found.map((f) => path.join(cwd, f)));
  }

  const excluded = new Set<string>();
  for (const pattern of excludePatterns) {
    const found = fs.globSync(pattern, { cwd });
    for (const file of found) {
      excluded.add(path.join(cwd, file));
    }
  }

  return [...new Set(files)].filter((file) => !excluded.has(file)).sort();
}
