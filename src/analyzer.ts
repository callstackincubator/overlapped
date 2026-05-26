import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AnalysisResult, OvelappedConfig, TestEntry } from './types.js';
import { loadCoverageMap, buildFingerprint, checkSubsumption } from './coverage.js';
import { extractTests } from './extractor.js';
import { runCoverage } from './runner.js';

export async function analyze(
  config: OvelappedConfig,
  cwd: string,
): Promise<AnalysisResult[]> {
  const refCoverageDir = path.join(cwd, '.ovelapped', 'reference');
  fs.mkdirSync(refCoverageDir, { recursive: true });

  // Phase 1: Run reference suite
  process.stderr.write('Running reference suite with coverage...\n');

  const refOk = await runCoverage({
    runner: config.runner,
    cwd,
    coverageDir: refCoverageDir,
    project: config.referenceProject,
  });

  if (!refOk) {
    throw new Error(
      'Reference suite did not produce coverage. Check that coverage is configured.',
    );
  }

  const refMap = loadCoverageMap(refCoverageDir);
  const refFp = buildFingerprint(refMap);
  const refStmts = [...refFp].filter((k) => k.includes(':s:')).length;
  const refBranches = [...refFp].filter((k) => k.includes(':b:')).length;
  process.stderr.write(
    `  Reference: ${refStmts} statements, ${refBranches} branches covered.\n`,
  );

  // Phase 2: Discover unit tests
  process.stderr.write('\nDiscovering unit tests...\n');

  const testFiles = findTestFiles(cwd, config.unitInclude);
  const allTests: TestEntry[] = [];
  for (const file of testFiles) {
    const tests = extractTests(file);
    allTests.push(...tests);
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
      const covDir = path.join(cwd, '.ovelapped', `test-${idx}`);
      fs.mkdirSync(covDir, { recursive: true });

      try {
        const ok = await runCoverage({
          runner: config.runner,
          cwd,
          coverageDir: covDir,
          project: config.unitProject,
          testFile: path.relative(cwd, test.file),
          testNamePattern: test.name,
          timeout: 60_000,
        });

        if (!ok) {
          return {
            test,
            status: 'error' as const,
            uniqueStatements: 0,
            uniqueBranches: 0,
            totalStatements: 0,
            totalBranches: 0,
            error: 'No coverage produced',
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
  fs.rmSync(path.join(cwd, '.ovelapped'), { recursive: true, force: true });

  return results;
}

function findTestFiles(cwd: string, patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    const found = fs.globSync(pattern, { cwd });
    files.push(...found.map((f) => path.join(cwd, f)));
  }
  return [...new Set(files)].sort();
}
