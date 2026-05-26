import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Runner } from './types.js';
import { escapeTestNameForRegex } from './extractor.js';

export function detectRunner(cwd: string): Runner {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `No package.json found in ${cwd}.\nRun overlapped from your project root.`,
    );
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
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
    'Could not detect a test runner in this project.\n\n' +
      'overlapped looks for vitest or jest in dependencies, devDependencies, or common config files.\n\n' +
      'Try one of these:\n' +
      '  overlapped analyze --runner vitest\n' +
      '  overlapped analyze --runner jest\n\n' +
      'If this project has no local runner yet, install one first:\n' +
      '  npm install -D vitest @vitest/coverage-v8\n' +
      '  npm install -D jest',
  );
}

function resolveRunnerBin(runner: Runner, cwd: string): string {
  const binPath = path.join(cwd, 'node_modules', '.bin', runner);
  if (!fs.existsSync(binPath)) {
    throw new Error(
      `${runner} not found in project dependencies.\nInstall it with: npm install -D ${runner}`,
    );
  }
  return binPath;
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
  const { runner, cwd, coverageDir, project, testFile, testNamePattern } = opts;
  const bin = resolveRunnerBin(runner, cwd);

  if (runner === 'vitest') {
    const parts = [bin, 'run'];
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

  const parts = [bin];
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
    exec(cmd, { cwd: opts.cwd, timeout }, () => {
      const covFile = path.join(opts.coverageDir, 'coverage-final.json');
      resolve(fs.existsSync(covFile));
    });
  });
}
