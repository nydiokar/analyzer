#!/usr/bin/env ts-node
/**
 * Revert Frontend Logger Changes
 *
 * This script reverts any logger imports and usage in frontend (dashboard) code
 * back to console.error/console.warn/console.log
 *
 * Frontend can't use backend winston logger - it needs browser console
 */

import * as fs from 'fs';
import * as path from 'path';

const DASHBOARD_DIR = 'dashboard/src';

function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function hasLoggerImport(content: string): boolean {
  return /import logger from ['"][^'"]*logger['"]/.test(content);
}

function hasLoggerUsage(content: string): boolean {
  return /logger\.(error|warn|info|debug|log)\(/.test(content);
}

function revertFile(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (!hasLoggerImport(content) && !hasLoggerUsage(content)) {
    return false; // No changes needed
  }

  let newContent = content;
  let changes = 0;

  // Remove logger import line (with surrounding newlines)
  const beforeRemove = newContent;
  newContent = newContent.replace(/import logger from ['"][^'"]*logger['"];\n*/g, '');
  if (newContent !== beforeRemove) {
    changes++;
    console.log(`  - Removed logger import`);
  }

  // Replace logger.error with console.error
  const errorMatches = newContent.match(/logger\.error\(/g);
  if (errorMatches) {
    newContent = newContent.replace(/logger\.error\(/g, 'console.error(');
    changes += errorMatches.length;
    console.log(`  - Replaced ${errorMatches.length} logger.error → console.error`);
  }

  // Replace logger.warn with console.warn
  const warnMatches = newContent.match(/logger\.warn\(/g);
  if (warnMatches) {
    newContent = newContent.replace(/logger\.warn\(/g, 'console.warn(');
    changes += warnMatches.length;
    console.log(`  - Replaced ${warnMatches.length} logger.warn → console.warn`);
  }

  // Replace logger.info with console.log
  const infoMatches = newContent.match(/logger\.info\(/g);
  if (infoMatches) {
    newContent = newContent.replace(/logger\.info\(/g, 'console.log(');
    changes += infoMatches.length;
    console.log(`  - Replaced ${infoMatches.length} logger.info → console.log`);
  }

  // Replace logger.debug with console.log
  const debugMatches = newContent.match(/logger\.debug\(/g);
  if (debugMatches) {
    newContent = newContent.replace(/logger\.debug\(/g, 'console.log(');
    changes += debugMatches.length;
    console.log(`  - Replaced ${debugMatches.length} logger.debug → console.log`);
  }

  // Replace logger.log with console.log
  const logMatches = newContent.match(/logger\.log\(/g);
  if (logMatches) {
    newContent = newContent.replace(/logger\.log\(/g, 'console.log(');
    changes += logMatches.length;
    console.log(`  - Replaced ${logMatches.length} logger.log → console.log`);
  }

  if (changes > 0) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return true;
  }

  return false;
}

function main() {
  console.log('🔧 Reverting Frontend Logger Changes\n');
  console.log('This will replace logger.* with console.* in dashboard files\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const dashboardPath = path.join(process.cwd(), DASHBOARD_DIR);

  if (!fs.existsSync(dashboardPath)) {
    console.error(`❌ Dashboard directory not found: ${dashboardPath}`);
    console.error('Make sure you run this from the project root directory');
    process.exit(1);
  }

  const files = findTypeScriptFiles(dashboardPath);
  console.log(`📁 Found ${files.length} TypeScript files in dashboard\n`);

  let modifiedCount = 0;
  const modifiedFiles: string[] = [];

  files.forEach(file => {
    const relativePath = path.relative(process.cwd(), file);
    const wasModified = revertFile(file);

    if (wasModified) {
      modifiedCount++;
      modifiedFiles.push(relativePath);
      console.log(`✅ ${relativePath}\n`);
    }
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    📊 SUMMARY                                 ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (modifiedCount === 0) {
    console.log('✅ No logger usage found in dashboard files - nothing to revert');
  } else {
    console.log(`✅ Modified ${modifiedCount} file(s):`);
    modifiedFiles.forEach((file, idx) => {
      console.log(`   ${idx + 1}. ${file}`);
    });
  }

  console.log('\n💡 Frontend should now use console.* for logging');
  console.log('   Browser console handles error objects properly\n');
}

try {
  main();
} catch (error) {
  console.error('Error running script:', error);
  process.exit(1);
}
