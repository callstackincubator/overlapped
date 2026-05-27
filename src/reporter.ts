import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult } from './types.js';

export interface Report {
  timestamp: string;
  totalTests: number;
  overlappedTests: number;
  uniqueTests: number;
  errorTests: number;
  fullyOverlappedFiles: string[];
  partiallyOverlappedFiles: {
    file: string;
    candidateTests: string[];
    keptTests: string[];
  }[];
  results: {
    file: string;
    name: string;
    status: AnalysisResult['status'];
    uniqueStatements: number;
    uniqueBranches: number;
  }[];
}

export function buildReport(results: AnalysisResult[]): Report {
  const overlapped = results.filter(isOverlapCandidate);
  const unique = results.filter((r) => r.status === 'unique');
  const errors = results.filter((r) => r.status === 'error');

  const byFile = new Map<string, AnalysisResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.test.file) ?? [];
    existing.push(r);
    byFile.set(r.test.file, existing);
  }

  const fullyOverlappedFiles: string[] = [];
  const partiallyOverlappedFiles: Report['partiallyOverlappedFiles'] = [];

  for (const [file, fileResults] of byFile) {
    const fileOverlapped = fileResults.filter(isOverlapCandidate);
    const fileKept = fileResults.filter((r) => !isOverlapCandidate(r));

    if (fileOverlapped.length === 0) continue;

    const relFile = path.relative(process.cwd(), file);

    if (fileKept.length === 0) {
      fullyOverlappedFiles.push(relFile);
    } else {
      partiallyOverlappedFiles.push({
        file: relFile,
        candidateTests: fileOverlapped.map((r) => r.test.name),
        keptTests: fileKept.map((r) => r.test.name),
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    overlappedTests: overlapped.length,
    uniqueTests: unique.length,
    errorTests: errors.length,
    fullyOverlappedFiles,
    partiallyOverlappedFiles,
    results: results.map((r) => ({
      file: path.relative(process.cwd(), r.test.file),
      name: r.test.name,
      status: r.status,
      uniqueStatements: r.uniqueStatements,
      uniqueBranches: r.uniqueBranches,
    })),
  };
}

export function writeReport(report: Report, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

export function printSummary(report: Report): void {
  console.log('\n\x1b[1m=== overlapped ===\x1b[0m\n');
  console.log(`Total tests analyzed: ${report.totalTests}`);
  console.log(
    `100% overlapped candidates: \x1b[33m${report.overlappedTests}\x1b[0m`,
  );
  console.log(
    `Tests with unique coverage: \x1b[32m${report.uniqueTests}\x1b[0m`,
  );
  if (report.errorTests > 0) {
    console.log(`Errors: \x1b[31m${report.errorTests}\x1b[0m`);
  }

  if (report.fullyOverlappedFiles.length > 0) {
    console.log(
      `\nFiles where every test is a removal candidate (${report.fullyOverlappedFiles.length}):`,
    );
    for (const f of report.fullyOverlappedFiles) {
      console.log(`  ${f}`);
    }
  }

  if (report.partiallyOverlappedFiles.length > 0) {
    console.log(
      `\nFiles with removal candidates (${report.partiallyOverlappedFiles.length}):`,
    );
    for (const f of report.partiallyOverlappedFiles) {
      console.log(
        `  ${f.file}: ${f.candidateTests.length} candidates, ${f.keptTests.length} with unique coverage`,
      );
    }
  }
}

function isOverlapCandidate(result: AnalysisResult): boolean {
  return result.status === 'overlapped';
}
