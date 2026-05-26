import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult } from './types.js';

export interface Report {
  timestamp: string;
  totalTests: number;
  subsumedTests: number;
  uniqueTests: number;
  errorTests: number;
  fullyRedundantFiles: string[];
  partiallyRedundantFiles: {
    file: string;
    redundantTests: string[];
    keptTests: string[];
  }[];
  results: {
    file: string;
    name: string;
    status: string;
    uniqueStatements: number;
    uniqueBranches: number;
  }[];
}

export function buildReport(results: AnalysisResult[]): Report {
  const subsumed = results.filter((r) => r.status === 'subsumed');
  const unique = results.filter((r) => r.status === 'unique');
  const errors = results.filter((r) => r.status === 'error');

  const byFile = new Map<string, AnalysisResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.test.file) ?? [];
    existing.push(r);
    byFile.set(r.test.file, existing);
  }

  const fullyRedundantFiles: string[] = [];
  const partiallyRedundantFiles: Report['partiallyRedundantFiles'] = [];

  for (const [file, fileResults] of byFile) {
    const fileSub = fileResults.filter((r) => r.status === 'subsumed');
    const fileKept = fileResults.filter((r) => r.status !== 'subsumed');

    if (fileSub.length === 0) continue;

    const relFile = path.relative(process.cwd(), file);

    if (fileKept.length === 0) {
      fullyRedundantFiles.push(relFile);
    } else {
      partiallyRedundantFiles.push({
        file: relFile,
        redundantTests: fileSub.map((r) => r.test.name),
        keptTests: fileKept.map((r) => r.test.name),
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    subsumedTests: subsumed.length,
    uniqueTests: unique.length,
    errorTests: errors.length,
    fullyRedundantFiles,
    partiallyRedundantFiles,
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
    `Subsumed (safe to remove): \x1b[33m${report.subsumedTests}\x1b[0m`,
  );
  console.log(
    `Unique (must keep): \x1b[32m${report.uniqueTests}\x1b[0m`,
  );
  if (report.errorTests > 0) {
    console.log(`Errors: \x1b[31m${report.errorTests}\x1b[0m`);
  }

  if (report.fullyRedundantFiles.length > 0) {
    console.log(
      `\nFiles to delete entirely (${report.fullyRedundantFiles.length}):`,
    );
    for (const f of report.fullyRedundantFiles) {
      console.log(`  ${f}`);
    }
  }

  if (report.partiallyRedundantFiles.length > 0) {
    console.log(
      `\nFiles with removable tests (${report.partiallyRedundantFiles.length}):`,
    );
    for (const f of report.partiallyRedundantFiles) {
      console.log(
        `  ${f.file}: ${f.redundantTests.length} to remove, ${f.keptTests.length} to keep`,
      );
    }
  }
}
