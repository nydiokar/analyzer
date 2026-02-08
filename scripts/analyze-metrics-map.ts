/**
 * Metrics Documentation Analyzer v2
 *
 * This script analyzes the codebase to extract all analysis metrics/factors
 * tracked per wallet across different analysis services, and compares them
 * against the documentation in docs/2. metrics_map.md
 *
 * Key improvement: Uses explicit table parsing to match metrics to their correct types
 * instead of guessing based on section headers.
 *
 * Usage:
 *   npx tsx scripts/analyze-metrics-map.ts
 *   npx tsx scripts/analyze-metrics-map.ts --generate-markdown
 *   npx tsx scripts/analyze-metrics-map.ts --ci (fails if discrepancies found)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MetricDefinition {
  name: string;
  type: string;
  sourceFile: string;
  lineNumber?: number;
  tsType?: string;
  isOptional: boolean;
  description?: string;
  deprecated?: boolean;
  category?: string;
}

interface TypeMetrics {
  typeName: string;
  sourceFile: string;
  category: string;
  metrics: MetricDefinition[];
}

interface DocumentedMetric {
  name: string;
  source: string;
  outputType: string;
  notes: string;
}

interface AnalysisReport {
  timestamp: string;
  summary: {
    totalMetricsInCode: number;
    totalMetricsInDocs: number;
    metricsInCodeOnly: number;
    metricsInDocsOnly: number;
    matchingMetrics: number;
  };
  byType: {
    [typeName: string]: {
      category: string;
      inCode: string[];
      inDocs: string[];
      inCodeOnly: string[];
      inDocsOnly: string[];
      coverage: number;
    };
  };
  detailedMetrics: TypeMetrics[];
  undocumentedMetrics: MetricDefinition[];
  documentedButMissing: DocumentedMetric[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  rootDir: path.resolve(__dirname, '..'),
  docsFileFull: path.resolve(__dirname, '..', 'docs', '2. metrics_map.md'),
  docsFileCompact: path.resolve(__dirname, '..', 'docs', '3.metrics_compact_map.md'),
  typesToAnalyze: [
    {
      name: 'OnChainAnalysisResult',
      file: 'src/types/helius-api.ts',
      category: 'PNL & Per-Token Metrics',
    },
    {
      name: 'SwapAnalysisSummary',
      file: 'src/types/helius-api.ts',
      category: 'Aggregated PNL Metrics',
    },
    {
      name: 'AdvancedTradeStats',
      file: 'src/types/helius-api.ts',
      category: 'Advanced Stats Metrics',
    },
    {
      name: 'BehavioralMetrics',
      file: 'src/types/behavior.ts',
      category: 'Behavior Analysis Metrics',
    },
    {
      name: 'CombinedPairwiseSimilarity',
      file: 'src/types/similarity.ts',
      category: 'Similarity Analysis - Pairwise',
    },
  ],
};

// ============================================================================
// COMPACT DOC (docs/3.metrics_compact_map.md) GENERATION / UPDATE HELPERS
// ============================================================================

const COMPACT_SECTIONS: Array<{
  typeName: string;
  heading: string;
}> = [
  {
    typeName: 'OnChainAnalysisResult',
    heading: '#### PNL per-token (SwapAnalyzer → OnChainAnalysisResult)',
  },
  {
    typeName: 'SwapAnalysisSummary',
    heading: '#### PNL summary (PnlAnalysisService → SwapAnalysisSummary)',
  },
  {
    typeName: 'AdvancedTradeStats',
    heading: '#### Advanced stats (AdvancedStatsAnalyzer → AdvancedTradeStats)',
  },
  {
    typeName: 'BehavioralMetrics',
    heading: '#### Behavior analysis (BehaviorAnalyzer → BehavioralMetrics)',
  },
  {
    typeName: 'CombinedPairwiseSimilarity',
    heading: '#### Similarity pairwise (SimilarityAnalyzer → CombinedPairwiseSimilarity)',
  },
];

function compactSectionHeadingByType(typeName: string): string | null {
  return COMPACT_SECTIONS.find(s => s.typeName === typeName)?.heading ?? null;
}

function formatCompactMissingBullet(typeName: string, missing: string[]): string {
  const joined = missing.join(', ');
  return `- MISSING (add): ${joined}`;
}

function parseCompactMetricsFromBulletLine(bulletLine: string): string[] {
  const trimmed = bulletLine.trim();
  if (!trimmed.startsWith('- ')) return [];
  const afterDash = trimmed.slice(2).trim();
  const withoutPrefix = afterDash.replace(/^[^:]+:\s*/, '');
  return withoutPrefix
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function mergeIntoBulletLine(params: { bulletLine: string; missing: string[] }): string {
  const { bulletLine, missing } = params;
  const existingParts = parseCompactMetricsFromBulletLine(bulletLine);
  const existingSet = new Set(existingParts);
  const toAdd = missing.filter(m => !existingSet.has(m));
  if (toAdd.length === 0) return bulletLine;

  // Preserve the line prefix exactly; just append ", x, y"
  const suffix = toAdd.join(', ');
  return bulletLine.replace(/\s*$/, '') + (existingParts.length > 0 ? ', ' : '') + suffix;
}

function pickBehaviorBulletIndex(sectionLines: string[], metricName: string): number | null {
  const lower = metricName.toLowerCase();
  const findLineIdx = (needle: string) => sectionLines.findIndex(l => l.toLowerCase().includes(needle));

  // Heuristics based on the existing headings in docs/3.metrics_compact_map.md
  if (lower.startsWith('tokenpreferences.') || lower.startsWith('riskmetrics.') || lower.startsWith('tradingfrequency.')) {
    const idx = findLineIdx('preferences/risk');
    return idx >= 0 ? idx : null;
  }

  if (
    lower.includes('holding') ||
    lower.includes('unrealizedpnl') ||
    lower.includes('percentofcurrentportfoliovalue') ||
    lower.includes('currentholdingsvalue')
  ) {
    const idx = findLineIdx('holding posture');
    return idx >= 0 ? idx : null;
  }

  if (lower.includes('strategytype') || lower.includes('speedcategory') || lower.includes('flowpattern') || lower.includes('historicalpattern') || lower.includes('tradinginterpretation')) {
    const idx = findLineIdx('classification');
    return idx >= 0 ? idx : null;
  }

  // Default: append to the last bullet line in section.
  for (let i = sectionLines.length - 1; i >= 0; i--) {
    if (sectionLines[i].trim().startsWith('- ')) return i;
  }
  return null;
}

function applyMissingToCompactDoc(params: {
  compactDocPath: string;
  missingByType: Map<string, string[]>;
}): { updated: boolean; newContent: string } {
  const { compactDocPath, missingByType } = params;
  const original = fs.readFileSync(compactDocPath, 'utf-8');
  const lines = original.split('\n');

  let inCompactList = false;
  let endOfCompactListIdx = -1;
  const headingToIndex = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().startsWith('### compact master list')) {
      inCompactList = true;
      continue;
    }
    if (!inCompactList) continue;
    if (line === '---') {
      endOfCompactListIdx = i;
      break;
    }
    for (const section of COMPACT_SECTIONS) {
      if (line === section.heading) {
        headingToIndex.set(section.heading, i);
      }
    }
  }

  const insertBefore = endOfCompactListIdx === -1 ? lines.length : endOfCompactListIdx;
  const updatedLines: string[] = [...lines];

  // Insert missing sections/headings if they don't exist (Similarity is likely missing).
  // We append them right before the `---` divider.
  const ensureHeading = (heading: string) => {
    if (headingToIndex.has(heading)) return;
    // Ensure a blank line before new headings for readability.
    if (updatedLines.length > 0 && updatedLines[insertBefore - 1]?.trim() !== '') {
      updatedLines.splice(insertBefore, 0, '');
    }
    updatedLines.splice(insertBefore, 0, heading);
    headingToIndex.set(heading, insertBefore);
  };

  for (const [typeName, missing] of missingByType.entries()) {
    if (missing.length === 0) continue;
    const heading = compactSectionHeadingByType(typeName);
    if (!heading) continue;
    ensureHeading(heading);
  }

  // Re-scan indices after heading insertions (simple approach).
  const rescannedHeadingToIndex = new Map<string, number>();
  inCompactList = false;
  for (let i = 0; i < updatedLines.length; i++) {
    const line = updatedLines[i].trim();
    if (line.toLowerCase().startsWith('### compact master list')) {
      inCompactList = true;
      continue;
    }
    if (!inCompactList) continue;
    if (line === '---') break;
    for (const section of COMPACT_SECTIONS) {
      if (line === section.heading) {
        rescannedHeadingToIndex.set(section.heading, i);
      }
    }
  }

  let updated = false;

  for (const [typeName, missing] of missingByType.entries()) {
    if (missing.length === 0) continue;
    const heading = compactSectionHeadingByType(typeName);
    if (!heading) continue;
    const headingIdx = rescannedHeadingToIndex.get(heading);
    if (headingIdx === undefined) continue;

    // Find section range: from heading until next heading or divider.
    let insertAt = headingIdx + 1;
    while (insertAt < updatedLines.length) {
      const t = updatedLines[insertAt].trim();
      if (t.startsWith('#### ') || t === '---') break;
      insertAt++;
    }

    const sectionLines = updatedLines.slice(headingIdx + 1, insertAt);
    const sectionStart = headingIdx + 1;

    // Merge missing metrics into an existing bullet line (minimal change). If section has no bullets, create one.
    if (typeName === 'BehavioralMetrics') {
      // Distribute across existing bullets to keep the structure readable.
      const remaining = [...missing];
      while (remaining.length > 0) {
        const m = remaining.shift()!;
        const targetRelIdx = pickBehaviorBulletIndex(sectionLines, m);
        if (targetRelIdx === null) {
          // Create a new bullet at end of section.
          updatedLines.splice(insertAt, 0, `- ${m}`);
          updated = true;
          insertAt++;
          sectionLines.push(`- ${m}`);
          continue;
        }
        const absIdx = sectionStart + targetRelIdx;
        const before = updatedLines[absIdx];
        const after = mergeIntoBulletLine({ bulletLine: before, missing: [m] });
        if (after !== before) {
          updatedLines[absIdx] = after;
          updated = true;
          sectionLines[targetRelIdx] = after;
        }
      }
      continue;
    }

    const bulletIdx = sectionLines.findIndex(l => l.trim().startsWith('- '));
    if (bulletIdx >= 0) {
      const absIdx = sectionStart + bulletIdx;
      const before = updatedLines[absIdx];
      const after = mergeIntoBulletLine({ bulletLine: before, missing });
      if (after !== before) {
        updatedLines[absIdx] = after;
        updated = true;
      }
    } else {
      // Section is empty: create a single bullet with all missing names.
      updatedLines.splice(insertAt, 0, `- ${missing.join(', ')}`, '');
      updated = true;
    }
  }

  return { updated, newContent: updatedLines.join('\n') };
}

// ============================================================================
// TYPESCRIPT AST PARSER
// ============================================================================

class TypeScriptMetricsExtractor {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(private rootDir: string) {
    const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      throw new Error('Could not find tsconfig.json');
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
    this.checker = this.program.getTypeChecker();
  }

  /**
   * Extract all fields from a TypeScript interface or type alias
   */
  extractMetricsFromType(filePath: string, typeName: string, category: string): TypeMetrics {
    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Could not find source file: ${filePath}`);
    }

    const metrics: MetricDefinition[] = [];
    const visit = (node: ts.Node) => {
      // Check for interface declarations
      if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
        this.extractMembersFromType(node, sourceFile, metrics, category, typeName);
      }
      // Check for type alias declarations
      else if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
        if (ts.isTypeLiteralNode(node.type)) {
          this.extractMembersFromTypeLiteral(node.type, sourceFile, metrics, category, typeName);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      typeName,
      sourceFile: filePath,
      category,
      metrics,
    };
  }

  private extractMembersFromType(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile,
    metrics: MetricDefinition[],
    category: string,
    parentTypeName: string
  ) {
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const extracted = this.createMetricDefinitions(member, sourceFile, category, parentTypeName);
        metrics.push(...extracted);
      }
    }
  }

  private extractMembersFromTypeLiteral(
    node: ts.TypeLiteralNode,
    sourceFile: ts.SourceFile,
    metrics: MetricDefinition[],
    category: string,
    parentTypeName: string
  ) {
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const extracted = this.createMetricDefinitions(member, sourceFile, category, parentTypeName);
        metrics.push(...extracted);
      }
    }
  }

  private createMetricDefinitions(
    member: ts.PropertySignature,
    sourceFile: ts.SourceFile,
    category: string,
    parentTypeName: string
  ): MetricDefinition[] {
    if (!member.name || !ts.isIdentifier(member.name)) {
      return [];
    }

    const name = member.name.text;

    // Special-case: Expand certain nested Behavior metrics so docs using dotted names can match code.
    // This keeps the comparison truthful without forcing docs to change style.
    const shouldExpandNested =
      parentTypeName === 'BehavioralMetrics' &&
      (name === 'tradingFrequency' || name === 'tokenPreferences' || name === 'riskMetrics') &&
      member.type &&
      ts.isTypeLiteralNode(member.type);

    if (shouldExpandNested && member.type) {
      const expanded: MetricDefinition[] = [];
      for (const nestedMember of member.type.members) {
        if (!ts.isPropertySignature(nestedMember) || !nestedMember.name || !ts.isIdentifier(nestedMember.name)) {
          continue;
        }
        const nestedName = `${name}.${nestedMember.name.text}`;
        const nestedIsOptional = !!nestedMember.questionToken;
        const nestedTsType = nestedMember.type ? nestedMember.type.getText(sourceFile) : 'unknown';

        const nestedJsDocTags = ts.getJSDocTags(nestedMember);
        const nestedDeprecatedTag = nestedJsDocTags.find(tag => tag.tagName.text === 'deprecated');
        const nestedDescription = ts.getJSDocCommentsAndTags(nestedMember)
          .map(comment => {
            if (ts.isJSDoc(comment)) {
              return comment.comment?.toString() || '';
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');

        const nestedLineNumber = sourceFile.getLineAndCharacterOfPosition(nestedMember.getStart()).line + 1;

        expanded.push({
          name: nestedName,
          type: this.simplifyType(nestedTsType),
          sourceFile: sourceFile.fileName,
          lineNumber: nestedLineNumber,
          tsType: nestedTsType,
          isOptional: nestedIsOptional,
          description: nestedDescription || undefined,
          deprecated: !!nestedDeprecatedTag,
          category,
        });
      }
      return expanded;
    }

    const isOptional = !!member.questionToken;
    const tsType = member.type ? member.type.getText(sourceFile) : 'unknown';

    // Extract JSDoc comments for description and @deprecated tag
    const jsDocTags = ts.getJSDocTags(member);
    const deprecatedTag = jsDocTags.find(tag => tag.tagName.text === 'deprecated');
    const description = ts.getJSDocCommentsAndTags(member)
      .map(comment => {
        if (ts.isJSDoc(comment)) {
          return comment.comment?.toString() || '';
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');

    const lineNumber = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;

    return [
      {
        name,
        type: this.simplifyType(tsType),
        sourceFile: sourceFile.fileName,
        lineNumber,
        tsType,
        isOptional,
        description: description || undefined,
        deprecated: !!deprecatedTag,
        category,
      },
    ];
  }

  private simplifyType(tsType: string): string {
    // Simplify complex types for readability
    if (tsType.includes('Record<')) return 'Record';
    if (tsType.includes('Array<') || tsType.endsWith('[]')) return 'Array';
    if (tsType.includes('|')) return 'Union';
    if (tsType === 'number') return 'number';
    if (tsType === 'string') return 'string';
    if (tsType === 'boolean') return 'boolean';
    return tsType;
  }
}

// ============================================================================
// DOCUMENTATION PARSER - IMPROVED VERSION
// ============================================================================

class DocumentationParser {
  private docsContent: string;
  private readonly knownTypes = new Set([
    'OnChainAnalysisResult',
    'SwapAnalysisSummary',
    'AdvancedTradeStats',
    'BehavioralMetrics',
    'CombinedPairwiseSimilarity',
  ]);
  private readonly mode: 'full' | 'compact';

  constructor(docsFilePath: string, mode: 'full' | 'compact') {
    if (!fs.existsSync(docsFilePath)) {
      throw new Error(`Documentation file not found: ${docsFilePath}`);
    }
    this.docsContent = fs.readFileSync(docsFilePath, 'utf-8');
    this.mode = mode;
  }

  /**
   * Extract metric names from documentation tables with proper type attribution
   *
   * Strategy:
   * - Only trust the "Updated" tables (the ones with a "Status" column), so legacy mapping tables
   *   don't pollute results.
   * - Skip rows explicitly marked REMOVED / POSTPONED / Future Consideration.
   * - Support multi-metric cells like `walletA` / `walletB`.
   * - Normalize metric aliases like `firstTransactionTimestamp (adv)` -> `firstTransactionTimestamp`.
   */
  extractDocumentedMetrics(): Map<string, Set<string>> {
    if (this.mode === 'compact') {
      return this.extractDocumentedMetricsCompact();
    }
    return this.extractDocumentedMetricsFull();
  }

  private extractDocumentedMetricsFull(): Map<string, Set<string>> {
    const metricsByType = new Map<string, Set<string>>();
    const lines = this.docsContent.split('\n');

    let inAuthoritativeTable = false;
    let currentTypeContext: string | null = null;
    let lastSectionHeader: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('###')) {
        lastSectionHeader = line;
      }

      // Skip non-table lines
      if (!line.trim().startsWith('|')) {
        inAuthoritativeTable = false;
        currentTypeContext = null;
        continue;
      }

      // Parse the table row
      const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);

      // Skip header and separator rows
      if (cells.length < 3) continue;
      if (cells[0].startsWith('-')) continue;
      if (cells[0].toLowerCase().includes('metric')) {
        // Only treat tables that have a "Status" column as authoritative.
        inAuthoritativeTable = this.isAuthoritativeTableHeader(cells);
        currentTypeContext = null;
        continue;
      }

      if (!inAuthoritativeTable) continue;
      if (this.shouldSkipRow(cells)) continue;

      // If this is a group/subsection row (e.g., "**Pairwise Similarity Metrics**"),
      // it can carry the type context for subsequent rows.
      const maybeContextType = this.findKnownTypeInCells(cells);
      if (maybeContextType) {
        currentTypeContext = maybeContextType;
      }

      // Extract metric name(s) (first column, backticked; can contain multiple entries)
      const rawMetricNames = this.extractBacktickedValues(cells[0]).map(v => this.normalizeMetricName(v));
      if (rawMetricNames.length === 0) continue;

      // Determine type: explicit mention in row -> current table context -> nearest section header.
      const explicitType = this.findKnownTypeInCells(cells);
      const inferredFromHeader = lastSectionHeader ? this.inferTypeFromSection(lastSectionHeader) : null;
      const typeName = explicitType || currentTypeContext || inferredFromHeader;

      // If still no type, skip this metric
      if (!typeName || !this.knownTypes.has(typeName)) continue;

      // Add to the map
      if (!metricsByType.has(typeName)) {
        metricsByType.set(typeName, new Set());
      }
      for (const metricName of rawMetricNames) {
        if (metricName.length === 0) continue;
        metricsByType.get(typeName)!.add(metricName);
      }
    }

    return metricsByType;
  }

  private extractDocumentedMetricsCompact(): Map<string, Set<string>> {
    const metricsByType = new Map<string, Set<string>>();
    const lines = this.docsContent.split('\n');

    let inCompactList = false;
    let currentType: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.toLowerCase().startsWith('### compact master list')) {
        inCompactList = true;
        currentType = null;
        continue;
      }

      // Stop at the divider after the compact list.
      if (inCompactList && line === '---') break;
      if (!inCompactList) continue;

      if (line.startsWith('####')) {
        currentType = this.inferTypeFromCompactHeading(line);
        continue;
      }

      if (!currentType) continue;
      if (!line.startsWith('- ')) continue;

      // Bullet lines are comma-separated lists, sometimes prefixed with e.g. "Flipper:".
      const afterDash = line.slice(2).trim();
      const withoutPrefix = afterDash.replace(/^[^:]+:\s*/, '');

      const parts = withoutPrefix
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      if (!metricsByType.has(currentType)) {
        metricsByType.set(currentType, new Set());
      }

      for (const part of parts) {
        const metricName = this.normalizeMetricName(part);
        if (metricName.length === 0) continue;
        metricsByType.get(currentType)!.add(metricName);
      }
    }

    return metricsByType;
  }

  private inferTypeFromCompactHeading(headingLine: string): string | null {
    const lower = headingLine.toLowerCase();

    if (lower.includes('pnl per-token') || lower.includes('onchainanalysisresult')) return 'OnChainAnalysisResult';
    if (lower.includes('pnl summary') || lower.includes('swapanalysissummary')) return 'SwapAnalysisSummary';
    if (lower.includes('advanced stats') || lower.includes('advancedtradestats')) return 'AdvancedTradeStats';
    if (lower.includes('behavior analysis') || lower.includes('behavioralmetrics')) return 'BehavioralMetrics';
    if (lower.includes('similarity pairwise') || lower.includes('combinedpairwisesimilarity')) return 'CombinedPairwiseSimilarity';

    // PNL overview is a class, not part of current TS type extraction; ignore for now.
    if (lower.includes('pnl overview')) return null;

    return null;
  }

  private isAuthoritativeTableHeader(cells: string[]): boolean {
    const headerText = cells.join(' ').toLowerCase();
    return headerText.includes('status');
  }

  private shouldSkipRow(cells: string[]): boolean {
    const text = cells.join(' ').toLowerCase();
    if (text.includes('**removed**') || text.includes('removed.')) return true;
    if (text.includes('**postponed') || text.includes('postponed')) return true;
    if (text.includes('future consideration')) return true;
    return false;
  }

  private extractBacktickedValues(cell: string): string[] {
    const results: string[] = [];
    const re = /`([^`]+)`/g;
    for (let match = re.exec(cell); match; match = re.exec(cell)) {
      results.push(match[1]);
    }
    return results;
  }

  private normalizeMetricName(metricName: string): string {
    // `firstTransactionTimestamp (adv)` -> `firstTransactionTimestamp`
    const withoutParenSuffix = metricName.replace(/\s*\([^)]*\)\s*$/, '');
    return withoutParenSuffix.trim();
  }

  private findKnownTypeInCells(cells: string[]): string | null {
    for (const cell of cells) {
      const found = this.findKnownTypeInText(cell);
      if (found) return found;
    }
    return null;
  }

  private findKnownTypeInText(text: string): string | null {
    // Handle backticked types like `CombinedPairwiseSimilarity[]` or `OnChainAnalysisResult`.
    const backticked = /`([^`]+)`/g;
    for (let match = backticked.exec(text); match; match = backticked.exec(text)) {
      const raw = match[1];
      const normalized = raw.replace(/\[\]$/, '').trim();
      if (this.knownTypes.has(normalized)) return normalized;
    }
    return null;
  }

  private inferTypeFromSection(sectionHeader: string): string | null {
    const header = sectionHeader.toLowerCase();

    if (header.includes('per-token')) return 'OnChainAnalysisResult';
    if (header.includes('aggregated pnl')) return 'SwapAnalysisSummary';
    if (header.includes('advanced stats')) return 'AdvancedTradeStats';
    if (header.includes('behavior') || header.includes('flipper') || header.includes('activity')) return 'BehavioralMetrics';
    if (header.includes('pairwise')) return 'CombinedPairwiseSimilarity';
    if (header.includes('similarity')) return 'CombinedSimilarityResult';

    return null;
  }
}

// ============================================================================
// REPORT GENERATOR
// ============================================================================

class ReportGenerator {
  generateReport(
    codeMetrics: TypeMetrics[],
    documentedMetrics: Map<string, Set<string>>
  ): AnalysisReport {
    const timestamp = new Date().toISOString();
    const byType: AnalysisReport['byType'] = {};
    const undocumentedMetrics: MetricDefinition[] = [];
    const documentedButMissing: DocumentedMetric[] = [];

    let totalMetricsInCode = 0;
    let totalMetricsInDocs = 0;

    // Analyze each type
    for (const typeMetrics of codeMetrics) {
      const typeName = typeMetrics.typeName;
      const inCode = typeMetrics.metrics.map(m => m.name);
      const inDocs = Array.from(documentedMetrics.get(typeName) || []);

      totalMetricsInCode += inCode.length;
      totalMetricsInDocs += inDocs.length;

      const inCodeSet = new Set(inCode);
      const inDocsSet = new Set(inDocs);

      const inCodeOnly = inCode.filter(m => !inDocsSet.has(m));
      const inDocsOnly = inDocs.filter(m => !inCodeSet.has(m));
      const matching = inCode.filter(m => inDocsSet.has(m));

      const coverage = inCode.length > 0
        ? ((matching.length / inCode.length) * 100)
        : 0;

      byType[typeName] = {
        category: typeMetrics.category,
        inCode,
        inDocs,
        inCodeOnly,
        inDocsOnly,
        coverage,
      };

      // Collect undocumented metrics with full details
      for (const metric of typeMetrics.metrics) {
        if (!inDocsSet.has(metric.name)) {
          undocumentedMetrics.push(metric);
        }
      }

      // Collect documented but missing metrics
      for (const metricName of inDocsOnly) {
        documentedButMissing.push({
          name: metricName,
          source: typeName,
          outputType: typeName,
          notes: 'Documented but not found in TypeScript type definition',
        });
      }
    }

    const metricsInCodeOnly = undocumentedMetrics.length;
    const metricsInDocsOnly = documentedButMissing.length;
    const matchingMetrics = totalMetricsInCode - metricsInCodeOnly;

    return {
      timestamp,
      summary: {
        totalMetricsInCode,
        totalMetricsInDocs,
        metricsInCodeOnly,
        metricsInDocsOnly,
        matchingMetrics,
      },
      byType,
      detailedMetrics: codeMetrics,
      undocumentedMetrics,
      documentedButMissing,
    };
  }

  printConsoleReport(report: AnalysisReport) {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║         ANALYSIS METRICS DOCUMENTATION REPORT                  ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    console.log(`Generated: ${report.timestamp}\n`);

    // Summary
    console.log('📊 SUMMARY');
    console.log('─'.repeat(70));
    console.log(`Total Metrics in Code:        ${report.summary.totalMetricsInCode}`);
    console.log(`Total Metrics in Docs:        ${report.summary.totalMetricsInDocs}`);
    console.log(`✅ Matching Metrics:          ${report.summary.matchingMetrics}`);
    console.log(`⚠️  Undocumented (Code Only): ${report.summary.metricsInCodeOnly}`);
    console.log(`❌ Documented but Missing:    ${report.summary.metricsInDocsOnly}`);
    console.log();

    // By Type Breakdown
    console.log('📋 BY TYPE BREAKDOWN');
    console.log('─'.repeat(70));
    for (const [typeName, data] of Object.entries(report.byType)) {
      const coverageStr = data.coverage.toFixed(1);
      const statusIcon = data.coverage === 100 ? '✅' : data.coverage >= 80 ? '⚠️' : '❌';

      console.log(`\n${statusIcon} ${typeName} (${data.category})`);
      console.log(`   In Code: ${data.inCode.length} | In Docs: ${data.inDocs.length} | Coverage: ${coverageStr}%`);

      if (data.inCodeOnly.length > 0) {
        console.log(`   ⚠️  Undocumented (${data.inCodeOnly.length}):`);
        const preview = data.inCodeOnly.slice(0, 3).join(', ');
        console.log(`      ${preview}${data.inCodeOnly.length > 3 ? ` ... +${data.inCodeOnly.length - 3} more` : ''}`);
      }

      if (data.inDocsOnly.length > 0) {
        console.log(`   ❌ Missing in Code (${data.inDocsOnly.length}):`);
        const preview = data.inDocsOnly.slice(0, 3).join(', ');
        console.log(`      ${preview}${data.inDocsOnly.length > 3 ? ` ... +${data.inDocsOnly.length - 3} more` : ''}`);
      }
    }
    console.log();

    // Undocumented Metrics Details
    if (report.undocumentedMetrics.length > 0) {
      console.log('\n⚠️  UNDOCUMENTED METRICS (Detailed)');
      console.log('─'.repeat(70));

      const byType = new Map<string, MetricDefinition[]>();
      for (const metric of report.undocumentedMetrics) {
        const typeName = this.getTypeNameFromMetric(metric);
        if (!byType.has(typeName)) {
          byType.set(typeName, []);
        }
        byType.get(typeName)!.push(metric);
      }

      for (const [typeName, metrics] of byType) {
        console.log(`\n${typeName} (${metrics.length} undocumented):`);
        const sortedMetrics = metrics.sort((a, b) => a.name.localeCompare(b.name));

        for (const metric of sortedMetrics.slice(0, 10)) {
          const optional = metric.isOptional ? '?' : '';
          const deprecated = metric.deprecated ? ' [DEPRECATED]' : '';
          console.log(`  • ${metric.name}${optional}: ${metric.tsType}${deprecated}`);
        }
        if (metrics.length > 10) {
          console.log(`  ... and ${metrics.length - 10} more`);
        }
      }
    }

    // Documented but Missing
    if (report.documentedButMissing.length > 0) {
      console.log('\n❌ DOCUMENTED BUT MISSING IN CODE');
      console.log('─'.repeat(70));

      const byType = new Map<string, string[]>();
      for (const metric of report.documentedButMissing) {
        if (!byType.has(metric.source)) {
          byType.set(metric.source, []);
        }
        byType.get(metric.source)!.push(metric.name);
      }

      for (const [typeName, metricNames] of byType) {
        console.log(`\n${typeName} (${metricNames.length} missing):`);
        const preview = metricNames.slice(0, 5).join(', ');
        console.log(`  ${preview}${metricNames.length > 5 ? ` ... +${metricNames.length - 5} more` : ''}`);
      }
    }

    console.log('\n' + '═'.repeat(70) + '\n');
  }

  generateMarkdownReport(report: AnalysisReport): string {
    let md = `# Analysis Metrics Documentation Report\n\n`;
    md += `**Generated:** ${report.timestamp}\n\n`;
    md += `---\n\n`;

    // Summary Table
    md += `## Summary\n\n`;
    md += `| Metric | Count |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Metrics in Code | ${report.summary.totalMetricsInCode} |\n`;
    md += `| Total Metrics in Docs | ${report.summary.totalMetricsInDocs} |\n`;
    md += `| ✅ Matching Metrics | ${report.summary.matchingMetrics} |\n`;
    md += `| ⚠️ Undocumented (Code Only) | ${report.summary.metricsInCodeOnly} |\n`;
    md += `| ❌ Documented but Missing | ${report.summary.metricsInDocsOnly} |\n\n`;

    // Coverage by Type
    md += `## Coverage by Type\n\n`;
    md += `| Type | Category | In Code | In Docs | Coverage | Status |\n`;
    md += `|------|----------|---------|---------|----------|--------|\n`;

    for (const [typeName, data] of Object.entries(report.byType)) {
      const coverageStr = data.coverage.toFixed(1);
      const status = data.coverage === 100 ? '✅' : data.coverage >= 80 ? '⚠️' : '❌';
      md += `| ${typeName} | ${data.category} | ${data.inCode.length} | ${data.inDocs.length} | ${coverageStr}% | ${status} |\n`;
    }
    md += `\n`;

    // Undocumented Metrics - Ready for Copy/Paste
    if (report.undocumentedMetrics.length > 0) {
      md += `## Undocumented Metrics (Copy-Paste Ready)\n\n`;
      md += `These metrics exist in code but are not documented. Add them to \`docs/2. metrics_map.md\`:\n\n`;

      const byType = new Map<string, MetricDefinition[]>();
      for (const metric of report.undocumentedMetrics) {
        const typeName = this.getTypeNameFromMetric(metric);
        if (!byType.has(typeName)) {
          byType.set(typeName, []);
        }
        byType.get(typeName)!.push(metric);
      }

      for (const [typeName, metrics] of byType) {
        const typeData = report.byType[typeName];
        md += `### ${typeName}\n\n`;
        md += `**Category:** ${typeData?.category || 'Unknown'}\n\n`;
        md += `| Metric | Source Analyzer/Service | Output Structure/Type | Status & Notes |\n`;
        md += `|--------|-------------------------|----------------------|----------------|\n`;

        const sortedMetrics = metrics.sort((a, b) => a.name.localeCompare(b.name));
        for (const metric of sortedMetrics) {
          const source = this.guessSourceAnalyzer(typeName);
          const optional = metric.isOptional ? ' (optional)' : '';
          const deprecated = metric.deprecated ? ' **DEPRECATED**' : '';
          const notes = metric.description || 'TODO: Add description';
          md += `| \`${metric.name}\` | ${source} | \`${typeName}\` | **NEW**${deprecated}${optional}. ${notes} |\n`;
        }
        md += `\n`;
      }
    }

    // Documented but Missing
    if (report.documentedButMissing.length > 0) {
      md += `## Documented but Missing in Code\n\n`;
      md += `These metrics are in the documentation but not found in the TypeScript types:\n\n`;

      const byType = new Map<string, string[]>();
      for (const metric of report.documentedButMissing) {
        if (!byType.has(metric.source)) {
          byType.set(metric.source, []);
        }
        byType.get(metric.source)!.push(metric.name);
      }

      for (const [typeName, metricNames] of byType) {
        md += `### ${typeName}\n\n`;
        for (const name of metricNames) {
          md += `- \`${name}\` - Verify this metric exists or remove from documentation\n`;
        }
        md += `\n`;
      }
    }

    // Detailed Metrics Inventory
    md += `## Complete Metrics Inventory by Type\n\n`;
    for (const typeMetrics of report.detailedMetrics) {
      md += `### ${typeMetrics.typeName}\n\n`;
      md += `**Category:** ${typeMetrics.category}\n\n`;
      md += `**Source:** \`${typeMetrics.sourceFile}\`\n\n`;
      md += `| Field | Type | Optional | Documented | Notes |\n`;
      md += `|-------|------|----------|------------|-------|\n`;

      const documented = new Set(report.byType[typeMetrics.typeName]?.inDocs || []);

      const sortedMetrics = typeMetrics.metrics.sort((a, b) => a.name.localeCompare(b.name));
      for (const metric of sortedMetrics) {
        const isDocumented = documented.has(metric.name) ? '✅' : '❌';
        const optional = metric.isOptional ? 'Yes' : 'No';
        const deprecated = metric.deprecated ? 'DEPRECATED' : '';
        const notes = [deprecated, metric.description].filter(Boolean).join('; ').slice(0, 80);
        md += `| \`${metric.name}\` | \`${metric.tsType}\` | ${optional} | ${isDocumented} | ${notes} |\n`;
      }
      md += `\n`;
    }

    return md;
  }

  private getTypeNameFromMetric(metric: MetricDefinition): string {
    // Extract type name from the source file path
    if (metric.sourceFile.includes('behavior.ts')) return 'BehavioralMetrics';
    if (metric.sourceFile.includes('similarity.ts')) {
      // Need to check category to differentiate
      return metric.category?.includes('Pairwise') ? 'CombinedPairwiseSimilarity' : 'CombinedSimilarityResult';
    }
    if (metric.sourceFile.includes('helius-api.ts')) {
      // Use category to determine which type
      if (metric.category?.includes('Per-Token')) return 'OnChainAnalysisResult';
      if (metric.category?.includes('Aggregated')) return 'SwapAnalysisSummary';
      if (metric.category?.includes('Advanced Stats')) return 'AdvancedTradeStats';
    }
    return 'Unknown';
  }

  private guessSourceAnalyzer(typeName: string): string {
    const mapping: Record<string, string> = {
      'OnChainAnalysisResult': 'SwapAnalyzer',
      'SwapAnalysisSummary': 'PnlAnalysisService',
      'AdvancedTradeStats': 'AdvancedStatsAnalyzer',
      'BehavioralMetrics': 'BehaviorAnalyzer',
      'CombinedSimilarityResult': 'SimilarityAnalyzer',
      'CombinedPairwiseSimilarity': 'SimilarityAnalyzer',
    };
    return mapping[typeName] || 'Unknown';
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const generateMarkdown = args.includes('--generate-markdown') || args.includes('-m');
  const ciMode = args.includes('--ci');
  const printCompactMissing = args.includes('--print-compact-missing');
  const applyCompactMissing = args.includes('--apply-compact-missing');
  const docsModeRaw = (() => {
    const idx = args.indexOf('--docs');
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  })();
  const docsMode: 'full' | 'compact' = docsModeRaw === 'full' ? 'full' : 'compact';

  console.log('🔍 Analyzing metrics across codebase...\n');

  try {
    // Initialize extractors
    const extractor = new TypeScriptMetricsExtractor(CONFIG.rootDir);
    const docsFilePath = docsMode === 'full' ? CONFIG.docsFileFull : CONFIG.docsFileCompact;
    const docsParser = new DocumentationParser(docsFilePath, docsMode);
    const reporter = new ReportGenerator();

    // Extract metrics from code
    console.log('📖 Extracting metrics from TypeScript definitions...');
    const codeMetrics: TypeMetrics[] = [];
    for (const typeConfig of CONFIG.typesToAnalyze) {
      const filePath = path.resolve(CONFIG.rootDir, typeConfig.file);
      console.log(`  - ${typeConfig.name} from ${typeConfig.file}`);
      const metrics = extractor.extractMetricsFromType(filePath, typeConfig.name, typeConfig.category);
      codeMetrics.push(metrics);
    }

    // Extract metrics from documentation
    console.log('\n📄 Extracting metrics from documentation...');
    const documentedMetrics = docsParser.extractDocumentedMetrics();

    console.log('\n📋 Documented metrics found:');
    for (const [typeName, metrics] of documentedMetrics.entries()) {
      console.log(`  - ${typeName}: ${metrics.size} metrics`);
    }

    // Generate report
    console.log('\n📊 Generating analysis report...');
    const report = reporter.generateReport(codeMetrics, documentedMetrics);

    // Optional: generate/apply compact-map missing metrics (meant for docsMode=compact)
    if (printCompactMissing || applyCompactMissing) {
      const missingByType = new Map<string, string[]>();

      for (const tm of codeMetrics) {
        const inDocs = new Set(Array.from(documentedMetrics.get(tm.typeName) || []));
        const missing = tm.metrics
          .map(m => m.name)
          .filter(name => !inDocs.has(name))
          .sort((a, b) => a.localeCompare(b));
        missingByType.set(tm.typeName, missing);
      }

      if (printCompactMissing) {
        console.log('\n🧩 COMPACT MAP - MISSING METRICS SNIPPET');
        console.log('─'.repeat(70));
        console.log(`Target: ${CONFIG.docsFileCompact}`);
        console.log('Add these sections/lines to `docs/3.metrics_compact_map.md` (within the Compact master list):\n');
        for (const [typeName, missing] of missingByType.entries()) {
          if (missing.length === 0) continue;
          const heading = compactSectionHeadingByType(typeName);
          if (!heading) continue;
          console.log(heading);
          console.log(formatCompactMissingBullet(typeName, missing));
          console.log();
        }
      }

      if (applyCompactMissing) {
        const { updated, newContent } = applyMissingToCompactDoc({
          compactDocPath: CONFIG.docsFileCompact,
          missingByType,
        });

        if (updated) {
          fs.writeFileSync(CONFIG.docsFileCompact, newContent, 'utf-8');
          console.log(`✅ Updated compact map with missing metrics: ${CONFIG.docsFileCompact}\n`);
        } else {
          console.log(`✅ Compact map already contains the generated missing-metrics bullets: ${CONFIG.docsFileCompact}\n`);
        }
      }
    }

    // Print to console
    reporter.printConsoleReport(report);

    // Generate markdown file if requested
    if (generateMarkdown) {
      const markdown = reporter.generateMarkdownReport(report);
      const outputPath = path.resolve(CONFIG.rootDir, 'docs', 'metrics-analysis-report.md');
      fs.writeFileSync(outputPath, markdown, 'utf-8');
      console.log(`✅ Markdown report generated: ${outputPath}\n`);
    }

    // Save JSON report
    const jsonOutputPath = path.resolve(CONFIG.rootDir, 'docs', 'metrics-analysis-report.json');
    fs.writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`✅ JSON report saved: ${jsonOutputPath}\n`);

    // CI mode - fail if there are discrepancies
    if (ciMode) {
      const hasIssues = report.summary.metricsInCodeOnly > 0 || report.summary.metricsInDocsOnly > 0;
      if (hasIssues) {
        console.error('❌ CI CHECK FAILED: Documentation is out of sync with code!\n');
        console.error(`   - ${report.summary.metricsInCodeOnly} metrics in code but not documented`);
        console.error(`   - ${report.summary.metricsInDocsOnly} metrics documented but missing in code`);
        console.error('\nRun `npx tsx scripts/analyze-metrics-map.ts --generate-markdown` to generate update snippets.\n');
        process.exit(1);
      } else {
        console.log('✅ CI CHECK PASSED: Documentation is in sync with code!\n');
        process.exit(0);
      }
    }

  } catch (error) {
    console.error('❌ Error during analysis:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { TypeScriptMetricsExtractor, DocumentationParser, ReportGenerator };
