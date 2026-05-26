import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Runner } from './types.js';
import { escapeTestNameForRegex } from './extractor.js';

export function detectRunner(cwd: string): Runner {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'),
  );
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (allDeps.vitest || fs.existsSync(path.join(cwd, 'vitest.config.ts'))) {
    return 'vitest';
  }
  if (allDeps.jest || fs.existsSync(path.join(cwd, 'jest.config.ts'))) {
    return 'jest';
  }

  throw new Error(
    'Could not detect test runner. Install vitest or jest, or use --runner.',
  );
}

interface RunCoverageOptions {
  runner: Runner;
  cwd: string;
  coverageDir: string;
  project?: string;
  testFile?: string;
  testNamePattern?: string;
  timeout?: number;
}

function buildCommand(opts: RunCoverageOptions): string {
  const { runner, coverageDir, project, testFile, testNamePattern } = opts;

  if (runner === 'vitest') {
    const parts = ['npx vitest run'];
    if (project) parts.push(`--project ${project}`);
    if (testFile) parts.push(`"${testFile}"`);
    if (testNamePattern) {
      const escaped = escapeTestNameForRegex(testNamePattern);
      parts.push(`--testNamePattern "^${escaped.replace(/"/g, '\\"')}$"`);
    }
    parts.push('--coverage');
    parts.push('--coverage.reporter=json');
    parts.push(`--coverage.reportsDirectory="${coverageDir}"`);
    parts.push('--coverage.all=false');
    parts.push('--coverage.thresholds.lines=0');
    parts.push('--coverage.thresholds.statements=0');
    parts.push('--coverage.reportOnFailure');
    return parts.join(' ');
  }

  // jest
  const parts = ['npx jest'];
  if (project) parts.push(`--config ${project}`);
  if (testFile) parts.push(`"${testFile}"`);
  if (testNamePattern) {
    const escaped = escapeTestNameForRegex(testNamePattern);
    parts.push(`--testNamePattern "^${escaped.replace(/"/g, '\\"')}$"`);
  }
  parts.push('--coverage');
  parts.push('--coverageReporters=json');
  parts.push(`--coverageDirectory="${coverageDir}"`);
  parts.push('--forceExit');
  return parts.join(' ');
}

export function runCoverage(opts: RunCoverageOptions): Promise<boolean> {
  const cmd = buildCommand(opts);
  const timeout = opts.timeout ?? 120_000;

  return new Promise((resolve) => {
    exec(cmd, { cwd: opts.cwd, timeout }, (error) => {
      const covFile = path.join(opts.coverageDir, 'coverage-final.json');
      resolve(fs.existsSync(covFile));
    });
  });
}
