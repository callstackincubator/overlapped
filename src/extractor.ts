import fs from 'node:fs';
import type { TestEntry } from './types.js';

export function extractTests(filePath: string): TestEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const tests: TestEntry[] = [];

  // Match test/it calls (including .skip, .only, .todo variants)
  const testPattern =
    /(?:^|\n)([ \t]*(?:test|it)(?:\.skip|\.only|\.todo)?\s*\()/gm;

  // Match test.each/it.each calls
  const eachPattern =
    /(?:^|\n)([ \t]*(?:test|it)\.each\s*(?:\(|\[))/gm;

  collectTests(content, testPattern, 'test', tests, filePath);
  collectTests(content, eachPattern, 'test.each', tests, filePath);

  tests.sort((a, b) => a.startOffset - b.startOffset);
  return tests;
}

function collectTests(
  content: string,
  pattern: RegExp,
  kind: 'test' | 'test.each',
  tests: TestEntry[],
  filePath: string,
): void {
  let match;
  while ((match = pattern.exec(content)) !== null) {
    let startOffset = match.index;
    if (content[startOffset] === '\n') startOffset++;

    const name = kind === 'test.each'
      ? extractEachTestName(content, startOffset)
      : extractTestName(content, startOffset);

    if (!name) continue;

    const endOffset = findBlockEnd(content, startOffset);
    if (endOffset === -1) continue;

    tests.push({ file: filePath, name, startOffset, endOffset, kind });
  }
}

function extractTestName(content: string, offset: number): string | null {
  // Find the opening paren of test(
  const parenIdx = content.indexOf('(', offset);
  if (parenIdx === -1) return null;

  // Find the quote character after the paren (skip whitespace)
  let i = parenIdx + 1;
  while (i < content.length && /\s/.test(content[i]!)) i++;

  const quote = content[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;

  return extractQuotedString(content, i);
}

function extractEachTestName(content: string, offset: number): string | null {
  // For test.each(...)(  'name', ...) or test.each[...]('name', ...)
  // We need to find the second opening paren that contains the test name
  const eachStart = content.indexOf('.each', offset);
  if (eachStart === -1) return null;

  // Find the opening bracket/paren of the data array
  let i = eachStart + 5;
  while (i < content.length && /\s/.test(content[i]!)) i++;

  const openChar = content[i];
  if (openChar !== '(' && openChar !== '[') return null;

  // Skip past the data array using bracket matching
  let depth = 0;
  for (; i < content.length; i++) {
    if (content[i] === '(' || content[i] === '[') depth++;
    else if (content[i] === ')' || content[i] === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }

  // Now find the second opening paren: (...'name'...)
  while (i < content.length && /\s/.test(content[i]!)) i++;
  if (content[i] !== '(') return null;
  i++;

  // Find the quote
  while (i < content.length && /\s/.test(content[i]!)) i++;
  const quote = content[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;

  return extractQuotedString(content, i);
}

function extractQuotedString(content: string, quoteStart: number): string | null {
  const quote = content[quoteStart];
  if (!quote) return null;

  let i = quoteStart + 1;
  let result = '';

  while (i < content.length) {
    if (content[i] === '\\') {
      result += content[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (content[i] === quote) {
      return result || null;
    }
    result += content[i];
    i++;
  }

  return null;
}

function findBlockEnd(content: string, startOffset: number): number {
  // Find the opening paren of the test() call
  const firstParen = content.indexOf('(', startOffset);
  if (firstParen === -1) return -1;

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
        return end;
      }
    }
  }

  return -1;
}

export function escapeTestNameForRegex(name: string): string {
  // For test.each names with $variable interpolation, replace $var with .*
  let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Re-expand $variable patterns that we just escaped
  escaped = escaped.replace(/\\\$\w+/g, '.*');
  return escaped;
}
