import fs from 'node:fs';
import path from 'node:path';
import type { CoverageMap } from './types.js';

export function loadCoverageMap(coverageDir: string): CoverageMap {
  const filePath = path.join(coverageDir, 'coverage-final.json');
  return loadCoverageFile(filePath);
}

export function loadCoverageFile(filePath: string): CoverageMap {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Coverage file not found: ${filePath}\n` +
        'Run your test suite with coverage enabled first, or pass the correct path with --reference-coverage.',
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePath(absPath: string): string {
  const srcIdx = absPath.indexOf('/src/');
  return srcIdx >= 0 ? absPath.slice(srcIdx) : absPath;
}

export function buildFingerprint(coverageMap: CoverageMap): Set<string> {
  const fp = new Set<string>();

  for (const entry of Object.values(coverageMap)) {
    const norm = normalizePath(entry.path);

    for (const [id, hits] of Object.entries(entry.s)) {
      if (hits > 0) fp.add(`${norm}:s:${id}`);
    }

    for (const [id, branchHits] of Object.entries(entry.b)) {
      for (let i = 0; i < branchHits.length; i++) {
        if (branchHits[i]! > 0) fp.add(`${norm}:b:${id}:${i}`);
      }
    }
  }

  return fp;
}

export function checkOverlap(
  testFp: Set<string>,
  referenceFp: Set<string>,
): { overlapped: boolean; uniqueStatements: number; uniqueBranches: number } {
  let uniqueStatements = 0;
  let uniqueBranches = 0;

  for (const key of testFp) {
    if (!referenceFp.has(key)) {
      if (key.includes(':s:')) uniqueStatements++;
      else if (key.includes(':b:')) uniqueBranches++;
    }
  }

  return {
    overlapped: uniqueStatements === 0 && uniqueBranches === 0,
    uniqueStatements,
    uniqueBranches,
  };
}
