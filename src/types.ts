export interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, unknown>;
  s: Record<string, number>;
  branchMap: Record<string, unknown>;
  b: Record<string, number[]>;
  fnMap: Record<string, unknown>;
  f: Record<string, number>;
}

export type CoverageMap = Record<string, IstanbulFileCoverage>;

export interface TestEntry {
  file: string;
  name: string;
  startOffset: number;
  endOffset: number;
  kind: 'test' | 'test.each';
}

export interface AnalysisResult {
  test: TestEntry;
  status: 'subsumed' | 'unique' | 'error';
  uniqueStatements: number;
  uniqueBranches: number;
  totalStatements: number;
  totalBranches: number;
  error?: string;
}

export type Runner = 'vitest' | 'jest';

export interface OvelappedConfig {
  runner: Runner;
  referenceProject?: string;
  referenceCommand?: string;
  unitProject?: string;
  unitInclude: string[];
  concurrency: number;
  reportPath: string;
}
