/**
 * Classification Usage Analyzer
 *
 * Scans codebase for all usages of classification-related fields:
 * - tradingStyle, flipperScore, behaviorType, speedCategory, flowPattern, strategyType
 * - HOLDER, FLIPPER, and other category names
 *
 * Outputs a JSON report showing:
 * - Where each field is used (file + line)
 * - What operation (read/write/filter/parse)
 * - Component layer (low/mid/high)
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface Usage {
  file: string;
  line: number;
  context: string;
  operation: 'read' | 'write' | 'filter' | 'parse' | 'type_def' | 'unknown';
  layer: 'low' | 'mid' | 'high' | 'unknown';
}

interface FieldReport {
  field: string;
  totalUsages: number;
  usagesByLayer: Record<string, number>;
  usagesByOperation: Record<string, number>;
  files: string[];
  details: Usage[];
}

interface AnalysisReport {
  generatedAt: string;
  fields: Record<string, FieldReport>;
  summary: {
    totalFiles: number;
    totalUsages: number;
    criticalFiles: string[]; // Files with multiple classification usages
  };
}

// Fields to track
const FIELDS_TO_TRACK = [
  'tradingStyle',
  'flipperScore',
  'velocityScore',
  'behaviorType',
  'speedCategory',
  'flowPattern',
  'strategyType',
  'tokensWithOnlyBuys',
  'medianCurrentHoldingDurationHours',
  'BehavioralPattern',
  'HolderBehaviorType',
  'TradingSpeedCategory',
];

// Keywords that indicate classification usage
const CLASSIFICATION_KEYWORDS = [
  'HOLDER', 'FLIPPER', 'SNIPER', 'SCALPER', 'MOMENTUM',
  'ACCUMULATOR', 'DISTRIBUTOR', 'BALANCED',
  'DAY_TRADER', 'SWING', 'POSITION',
];

// Determine layer based on file path
function determineLayer(filePath: string): 'low' | 'mid' | 'high' | 'unknown' {
  if (filePath.includes('src/core/analysis') || filePath.includes('src/types') || filePath.includes('prisma')) {
    return 'low'; // Core computation & storage
  }
  if (filePath.includes('src/api') || filePath.includes('src/queues')) {
    return 'mid'; // Transport & services
  }
  if (filePath.includes('dashboard/src')) {
    return 'high'; // Frontend
  }
  return 'unknown';
}

// Determine operation type from context
function determineOperation(line: string): 'read' | 'write' | 'filter' | 'parse' | 'type_def' | 'unknown' {
  if (line.includes('export type') || line.includes('interface') || line.includes('enum')) {
    return 'type_def';
  }
  if (line.includes('includes(') || line.includes('contains') || line.includes('ILIKE') || line.includes('===')) {
    return 'filter';
  }
  if (line.includes('.tradingStyle') && line.includes('(') && line.includes(')')) {
    return 'parse'; // Likely parsing tradingStyle string
  }
  if (line.includes('=') && !line.includes('==')) {
    return 'write';
  }
  if (line.includes('?.') || line.includes('||') || line.includes('&&')) {
    return 'read';
  }
  return 'unknown';
}

async function analyzeFile(filePath: string): Promise<Usage[]> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const usages: Usage[] = [];

  lines.forEach((line, index) => {
    FIELDS_TO_TRACK.forEach(field => {
      if (line.includes(field)) {
        usages.push({
          file: filePath.replace(process.cwd(), ''),
          line: index + 1,
          context: line.trim().substring(0, 100), // First 100 chars
          operation: determineOperation(line),
          layer: determineLayer(filePath),
        });
      }
    });

    // Also check for classification keywords
    CLASSIFICATION_KEYWORDS.forEach(keyword => {
      // Match whole word to avoid false positives
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        // Only if not a comment
        usages.push({
          file: filePath.replace(process.cwd(), ''),
          line: index + 1,
          context: line.trim().substring(0, 100),
          operation: determineOperation(line),
          layer: determineLayer(filePath),
        });
      }
    });
  });

  return usages;
}

async function main() {
  console.log('🔍 Analyzing classification field usage across codebase...\n');

  // Find all TypeScript files (exclude node_modules, dist, build)
  const files = await glob('**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**'],
  });

  console.log(`Found ${files.length} TypeScript files to analyze\n`);

  const allUsages: Usage[] = [];

  for (const file of files) {
    const usages = await analyzeFile(file);
    allUsages.push(...usages);
  }

  console.log(`Found ${allUsages.length} total usages\n`);

  // Group by field
  const fieldReports: Record<string, FieldReport> = {};

  [...FIELDS_TO_TRACK, ...CLASSIFICATION_KEYWORDS].forEach(field => {
    const fieldUsages = allUsages.filter(u => u.context.includes(field));

    if (fieldUsages.length === 0) return;

    const files = [...new Set(fieldUsages.map(u => u.file))];
    const byLayer = fieldUsages.reduce((acc, u) => {
      acc[u.layer] = (acc[u.layer] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const byOperation = fieldUsages.reduce((acc, u) => {
      acc[u.operation] = (acc[u.operation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    fieldReports[field] = {
      field,
      totalUsages: fieldUsages.length,
      usagesByLayer: byLayer,
      usagesByOperation: byOperation,
      files,
      details: fieldUsages.slice(0, 10), // First 10 for brevity
    };
  });

  // Find critical files (files with many classification usages)
  const fileUsageCounts = allUsages.reduce((acc, u) => {
    acc[u.file] = (acc[u.file] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const criticalFiles = Object.entries(fileUsageCounts)
    .filter(([_, count]) => count >= 5) // 5+ usages = critical
    .sort(([_, a], [__, b]) => b - a)
    .map(([file]) => file);

  const report: AnalysisReport = {
    generatedAt: new Date().toISOString(),
    fields: fieldReports,
    summary: {
      totalFiles: [...new Set(allUsages.map(u => u.file))].length,
      totalUsages: allUsages.length,
      criticalFiles,
    },
  };

  // Write report
  const outputPath = path.join(__dirname, '../../.ai/context/classification_usage_report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`✅ Report written to: ${outputPath}\n`);

  // Print summary
  console.log('📊 SUMMARY\n');
  console.log(`Total files: ${report.summary.totalFiles}`);
  console.log(`Total usages: ${report.summary.totalUsages}`);
  console.log(`\nCritical files (5+ usages):`);
  report.summary.criticalFiles.forEach(file => {
    console.log(`  - ${file} (${fileUsageCounts[file]} usages)`);
  });

  console.log(`\nTop fields:`);
  Object.entries(fieldReports)
    .sort(([_, a], [__, b]) => b.totalUsages - a.totalUsages)
    .slice(0, 10)
    .forEach(([field, report]) => {
      console.log(`  - ${field}: ${report.totalUsages} usages in ${report.files.length} files`);
    });

  console.log('\n✨ Done! Check the JSON report for full details.');
}

main().catch(console.error);
