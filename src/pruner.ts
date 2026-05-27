import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisResult } from './types.js';

export interface PruneResult {
  deletedFiles: string[];
  editedFiles: { file: string; removedTests: number; remainingTests: number }[];
  totalTestsRemoved: number;
}

export function pruneTests(
  results: AnalysisResult[],
  dryRun: boolean,
): PruneResult {
  const byFile = new Map<string, AnalysisResult[]>();

  for (const r of results) {
    const existing = byFile.get(r.test.file) ?? [];
    existing.push(r);
    byFile.set(r.test.file, existing);
  }

  const deletedFiles: string[] = [];
  const editedFiles: { file: string; removedTests: number; remainingTests: number }[] = [];
  let totalTestsRemoved = 0;

  for (const [file, fileResults] of byFile) {
    const fileOverlapped = fileResults.filter(isOverlapCandidate);
    const fileKept = fileResults.filter((r) => !isOverlapCandidate(r));

    if (fileOverlapped.length === 0) continue;

    const relPath = path.relative(process.cwd(), file);

    if (fileKept.length === 0) {
      if (dryRun) {
        console.log(`  DELETE ${relPath} (${fileOverlapped.length} tests)`);
      } else {
        fs.unlinkSync(file);
        console.log(`  Deleted ${relPath} (${fileOverlapped.length} tests)`);
      }
      deletedFiles.push(file);
      totalTestsRemoved += fileOverlapped.length;
      continue;
    }

    // Partial removal — remove individual test blocks
    let content = fs.readFileSync(file, 'utf8');
    let removedInFile = 0;

    // Sort by offset descending so removals don't shift indices
    const toRemove = fileOverlapped
      .map((r) => r.test)
      .sort((a, b) => b.startOffset - a.startOffset);

    for (const test of toRemove) {
      const block = findTestBlockByName(content, test.name);
      if (block) {
        content = content.slice(0, block.start) + content.slice(block.end);
        removedInFile++;
      }
    }

    content = content.replace(/\n{3,}/g, '\n\n');

    if (removedInFile > 0) {
      if (dryRun) {
        console.log(
          `  EDIT ${relPath}: remove ${removedInFile} tests, keep ${fileKept.length}`,
        );
        for (const r of fileOverlapped) {
          const short =
            r.test.name.length > 70
              ? r.test.name.slice(0, 67) + '...'
              : r.test.name;
          console.log(`    - ${short}`);
        }
      } else {
        fs.writeFileSync(file, content);
        console.log(
          `  Edited ${relPath}: removed ${removedInFile}, kept ${fileKept.length}`,
        );
      }
      editedFiles.push({
        file,
        removedTests: removedInFile,
        remainingTests: fileKept.length,
      });
      totalTestsRemoved += removedInFile;
    }
  }

  return { deletedFiles, editedFiles, totalTestsRemoved };
}

function isOverlapCandidate(result: AnalysisResult): boolean {
  return result.status === 'overlapped';
}

function findTestBlockByName(
  content: string,
  testName: string,
): { start: number; end: number } | null {
  const searchVariants = [
    `'${testName}'`,
    `"${testName}"`,
    `\`${testName}\``,
  ];

  let nameIdx = -1;
  for (const variant of searchVariants) {
    nameIdx = content.indexOf(variant);
    if (nameIdx !== -1) break;
  }

  if (nameIdx === -1) return null;

  // Walk backwards to find the test() call start
  let startIdx = nameIdx;
  while (startIdx > 0 && content[startIdx - 1] !== '\n') startIdx--;

  const linePrefix = content.slice(startIdx, nameIdx).trim();

  // Check for test.each — the test name might be in the second call
  const isTestEach = /(?:test|it)\.each/.test(
    content.slice(Math.max(0, startIdx - 200), nameIdx),
  );

  if (isTestEach) {
    // Walk further back to find test.each start
    const beforeName = content.slice(0, startIdx);
    const eachIdx = Math.max(
      beforeName.lastIndexOf('test.each'),
      beforeName.lastIndexOf('it.each'),
    );
    if (eachIdx !== -1) {
      startIdx = eachIdx;
      while (startIdx > 0 && content[startIdx - 1] !== '\n') startIdx--;
    }
  } else if (
    !linePrefix.match(/^(?:test|it)(?:\.skip|\.only|\.todo)?\s*\(/)
  ) {
    return null;
  }

  // Find end using bracket matching
  const firstParen = content.indexOf('(', startIdx);
  if (firstParen === -1) return null;

  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = firstParen; i < content.length; i++) {
    const ch = content[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (content[end] === ';') end++;
        if (content[end] === '\n') end++;
        if (content[end] === '\n') end++;
        return { start: startIdx, end };
      }
    }
  }

  return null;
}
