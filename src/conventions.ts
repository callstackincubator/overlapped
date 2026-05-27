import fs from 'node:fs';
import path from 'node:path';
import type { OverlappedConfig, Runner } from './types.js';
import { resolveRunnerBin } from './runner.js';

export function inferReferenceCommand(
  scripts: Record<string, string>,
  runner: Runner,
  cwd: string,
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

  return `${resolveDirectRunnerCommand(script, runner, cwd)} ${coverageArgs.join(' ')}`;
}

export function inferUnitConfig(
  scripts: Record<string, string>,
  runner: Runner,
  cwd: string,
  explicitProject: string | undefined,
  explicitInclude: string[] | undefined,
): {
  project?: string;
  include?: string[];
  scope?: string[];
  source?: OverlappedConfig['unitSource'];
} {
  const script = scripts['test:unit'];
  if (!script) return {};

  const parsed = parseRunnerScript(script, runner);
  const project = explicitProject ? undefined : parsed.project;
  const include = explicitInclude
    ? undefined
    : expandUnitFilters(parsed.filters, cwd);

  if (!project && !include) return {};
  return {
    project,
    include,
    scope: parsed.filters.length > 0 ? parsed.filters : undefined,
    source: 'test:unit',
  };
}

function resolveDirectRunnerCommand(
  script: string,
  runner: Runner,
  cwd: string,
): string {
  const tokens = tokenizeShellCommand(script);
  const runnerIndex = tokens.findIndex((token) => token === runner);
  if (runnerIndex !== 0) return script;

  tokens[runnerIndex] = resolveRunnerBin(runner, cwd);
  return tokens.map(quoteShellArgIfNeeded).join(' ');
}

function parseRunnerScript(
  script: string,
  runner: Runner,
): {
  project?: string;
  filters: string[];
} {
  const tokens = tokenizeShellCommand(script);
  const runnerIndex = tokens.findIndex((token) =>
    token === runner ||
    token.endsWith(`/${runner}`) ||
    token.endsWith(`\\${runner}`),
  );
  if (runnerIndex === -1) return { filters: [] };

  let project: string | undefined;
  const filters: string[] = [];
  const valueOptions = new Set([
    '--config',
    '-c',
    '--testNamePattern',
    '-t',
    '--runTestsByPath',
    '--testPathPattern',
    '--testPathPatterns',
    '--coverageDirectory',
    '--coverageReporters',
    '--coverage.reportsDirectory',
    '--coverage.reporter',
    '--reporter',
    '--environment',
    '--rootDir',
    '--roots',
    '--setupFiles',
    '--setupFilesAfterEnv',
  ]);

  for (let i = runnerIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (runner === 'vitest' && token === 'run') continue;
    if (token === '--') continue;

    const projectFlag = runner === 'vitest' ? '--project' : '--selectProjects';
    if (token === projectFlag) {
      project = tokens[i + 1];
      i++;
      continue;
    }
    if (token.startsWith(`${projectFlag}=`)) {
      project = token.slice(projectFlag.length + 1);
      continue;
    }

    if (valueOptions.has(token)) {
      i++;
      continue;
    }
    if (isOptionWithInlineValue(token)) continue;
    if (token.startsWith('-')) continue;

    filters.push(token);
  }

  return { project, filters };
}

function expandUnitFilters(filters: string[], cwd: string): string[] | undefined {
  const patterns: string[] = [];

  for (const filter of filters) {
    const absolute = path.resolve(cwd, filter);
    const exists = fs.existsSync(absolute);
    if (!exists && !isPathLikeFilter(filter)) continue;
    if (hasGlob(filter)) {
      patterns.push(filter);
      continue;
    }

    if (exists && fs.statSync(absolute).isFile()) {
      patterns.push(filter);
      continue;
    }

    if (exists && fs.statSync(absolute).isDirectory()) {
      patterns.push(...testPatternsForDirectory(filter));
      continue;
    }

    if (path.extname(filter)) {
      patterns.push(filter);
      continue;
    }

    patterns.push(...testPatternsForDirectory(filter));
  }

  return patterns.length > 0 ? patterns : undefined;
}

function testPatternsForDirectory(dir: string): string[] {
  const normalized = dir.replace(/\/$/, '');
  return [
    `${normalized}/**/*.test.ts`,
    `${normalized}/**/*.test.tsx`,
    `${normalized}/**/*.test.js`,
    `${normalized}/**/*.test.jsx`,
    `${normalized}/**/*.spec.ts`,
    `${normalized}/**/*.spec.tsx`,
    `${normalized}/**/*.spec.js`,
    `${normalized}/**/*.spec.jsx`,
  ];
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function quoteShellArgIfNeeded(value: string): string {
  return /[\s"'$`\\*?[\]{}]/.test(value) ? quoteShellArg(value) : value;
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/(["$`\\])/g, '\\$1')}"`;
}

function isPathLikeFilter(filter: string): boolean {
  return (
    filter.startsWith('.') ||
    filter.includes('/') ||
    filter.includes('\\') ||
    hasGlob(filter) ||
    path.extname(filter) !== ''
  );
}

function hasGlob(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function isOptionWithInlineValue(token: string): boolean {
  return token.startsWith('-') && token.includes('=');
}
