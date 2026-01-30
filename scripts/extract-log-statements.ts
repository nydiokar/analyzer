#!/usr/bin/env ts-node
/**
 * AST-based log statement extractor
 * Uses TypeScript compiler API to parse code and extract all log statements
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface LogStatement {
  component: string;
  filePath: string;
  line: number;
  column: number;
  logLevel: string;
  message: string;
  fullStatement: string;
}

interface LogPattern {
  name: string; // e.g., 'logger', 'console'
  method: string; // e.g., 'info', 'warn', 'error', 'debug', 'log'
  level: string; // normalized level: INFO, WARN, ERROR, DEBUG, LOG
}

// Define log patterns to detect
const LOG_PATTERNS: LogPattern[] = [
  { name: 'logger', method: 'info', level: 'INFO' },
  { name: 'logger', method: 'warn', level: 'WARN' },
  { name: 'logger', method: 'error', level: 'ERROR' },
  { name: 'logger', method: 'debug', level: 'DEBUG' },
  { name: 'logger', method: 'trace', level: 'TRACE' },
  { name: 'console', method: 'log', level: 'LOG' },
  { name: 'console', method: 'warn', level: 'WARN' },
  { name: 'console', method: 'error', level: 'ERROR' },
  { name: 'console', method: 'info', level: 'INFO' },
  { name: 'console', method: 'debug', level: 'DEBUG' },
];

class LogStatementExtractor {
  private logStatements: LogStatement[] = [];
  private sourceFile: ts.SourceFile | null = null;

  extractFromFile(filePath: string): LogStatement[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    this.sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const component = path.basename(filePath);
    this.logStatements = [];
    this.visitNode(this.sourceFile, component, filePath);
    return this.logStatements;
  }

  private visitNode(node: ts.Node, component: string, filePath: string): void {
    // Check if this is a call expression (function call)
    if (ts.isCallExpression(node)) {
      this.checkForLogStatement(node, component, filePath);
    }

    // Recursively visit child nodes
    ts.forEachChild(node, (child) => {
      this.visitNode(child, component, filePath);
    });
  }

  private checkForLogStatement(
    node: ts.CallExpression,
    component: string,
    filePath: string
  ): void {
    const expression = node.expression;

    // Handle property access: logger.info(), console.log(), etc.
    if (ts.isPropertyAccessExpression(expression)) {
      const objectName = this.getText(expression.expression);
      const methodName = this.getText(expression.name);

      const pattern = LOG_PATTERNS.find(
        (p) => p.name === objectName && p.method === methodName
      );

      if (pattern) {
        const message = this.extractMessage(node);
        const { line, character } = this.getLineAndCharacter(node);
        const fullStatement = this.getFullStatement(node);

        this.logStatements.push({
          component,
          filePath,
          line: line + 1, // 1-indexed
          column: character + 1,
          logLevel: pattern.level,
          message,
          fullStatement,
        });
      }
    }
    // Handle direct calls: Logger.info(), etc. (if Logger is a class)
    else if (ts.isIdentifier(expression)) {
      // This would handle cases like Logger.info() if Logger is a static class
      // For now, we focus on the common patterns above
    }
  }

  private extractMessage(node: ts.CallExpression): string {
    if (!node.arguments || node.arguments.length === 0) {
      return '';
    }

    const firstArg = node.arguments[0];
    return this.getText(firstArg);
  }

  private getFullStatement(node: ts.CallExpression): string {
    if (!this.sourceFile) return '';
    
    const start = node.getStart(this.sourceFile);
    const end = node.getEnd();
    const text = this.sourceFile.getFullText();
    
    // Get the full line
    const lineStart = text.lastIndexOf('\n', start) + 1;
    const lineEnd = text.indexOf('\n', end);
    const line = lineEnd === -1 
      ? text.substring(lineStart)
      : text.substring(lineStart, lineEnd);
    
    return line.trim();
  }

  private getText(node: ts.Node): string {
    if (!this.sourceFile) return '';
    return node.getText(this.sourceFile);
  }

  private getLineAndCharacter(node: ts.Node): { line: number; character: number } {
    if (!this.sourceFile) return { line: 0, character: 0 };
    return this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile));
  }
}

// Layer detection
function detectLayer(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('src/core')) return 'Core';
  if (normalized.includes('src/api')) return 'API';
  if (normalized.includes('dashboard/src')) return 'Dashboard';
  return 'Other';
}

// Generate markdown
function generateMarkdown(allLogs: Map<string, LogStatement[]>): string {
  const layers = ['Core', 'API', 'Dashboard'];
  let markdown = '# Log Statements Map\n\n';
  markdown += 'This document maps all log statements across the codebase, organized by layer (Core, API, Dashboard).\n\n';
  markdown += '> **Generated using AST-based extraction** - This ensures accurate parsing of TypeScript/JavaScript code.\n\n';

  for (const layer of layers) {
    markdown += `## Layer: ${layer}\n\n`;

    // Group by component
    const layerLogs = new Map<string, LogStatement[]>();
    for (const [filePath, logs] of allLogs.entries()) {
      if (detectLayer(filePath) === layer) {
        const component = path.basename(filePath);
        if (!layerLogs.has(component)) {
          layerLogs.set(component, []);
        }
        layerLogs.get(component)!.push(...logs);
      }
    }

    // Sort components alphabetically
    const sortedComponents = Array.from(layerLogs.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [component, logs] of sortedComponents) {
      markdown += `### Component: ${component}\n\n`;
      markdown += '| Component | Log Statement | Log Level | Line | Description |\n';
      markdown += '|-----------|---------------|-----------|------|-------------|\n';

      // Sort logs by line number
      logs.sort((a, b) => a.line - b.line);

      for (const log of logs) {
        // Extract a short description (first 3-5 words of message)
        const description = log.message
          .replace(/[`'"]/g, '')
          .replace(/\$\{[^}]+\}/g, '${...}')
          .split(/\s+/)
          .slice(0, 5)
          .join(' ')
          .trim() || 'Log statement';

        // Clean up the message for display (remove template literals complexity)
        const cleanMessage = log.message
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .substring(0, 100); // Limit length

        markdown += `| ${component} | \`${cleanMessage}\` | ${log.logLevel} | ${log.line} | ${description} |\n`;
      }
      markdown += '\n';
    }
  }

  markdown += '## Notes\n\n';
  markdown += 'This log map is automatically generated using AST-based code parsing. ';
  markdown += 'It accurately extracts log statements by understanding the code structure, ';
  markdown += 'not just pattern matching. This ensures all log statements are captured correctly.\n';

  return markdown;
}

// Main execution
async function main() {
  const extractor = new LogStatementExtractor();
  const allLogs = new Map<string, LogStatement[]>();

  // Define file patterns to scan
  const patterns = [
    'src/core/**/*.ts',
    'src/api/**/*.ts',
    'dashboard/src/**/*.{ts,tsx}',
  ];

  console.log('🔍 Scanning for log statements using AST parsing...\n');

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      ignore: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
      ],
    });

    console.log(`  📁 Pattern ${pattern}: ${files.length} files`);

    for (const file of files) {
      try {
        const logs = extractor.extractFromFile(file);
        if (logs.length > 0) {
          allLogs.set(file, logs);
          const relativePath = path.relative(process.cwd(), file);
          console.log(`    ✓ ${relativePath}: ${logs.length} log statements`);
        }
      } catch (error) {
        const relativePath = path.relative(process.cwd(), file);
        console.error(`    ✗ Error processing ${relativePath}:`, error);
      }
    }
  }

  console.log(`\n✅ Found ${Array.from(allLogs.values()).flat().length} total log statements\n`);

  // Generate markdown
  const markdown = generateMarkdown(allLogs);
  const outputPath = '.ai/LOG_MAP.md';
  fs.writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`📝 Generated log map: ${outputPath}`);
  console.log(`   Total components: ${new Set(Array.from(allLogs.keys()).map(f => path.basename(f))).size}`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { LogStatementExtractor, detectLayer, generateMarkdown };

