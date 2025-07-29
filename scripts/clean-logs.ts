#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

interface LogFileInfo {
  name: string;
  size: number;
  modified: Date;
  path: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getLogFiles(): LogFileInfo[] {
  if (!fs.existsSync(LOGS_DIR)) {
    console.log('📁 Logs directory does not exist');
    return [];
  }

  const files = fs.readdirSync(LOGS_DIR);
  const logFiles: LogFileInfo[] = [];

  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    const stats = fs.statSync(filePath);
    
    logFiles.push({
      name: file,
      size: stats.size,
      modified: stats.mtime,
      path: filePath
    });
  }

  return logFiles.sort((a, b) => b.size - a.size); // Sort by size descending
}

function cleanOldLogs(daysToKeep: number = 7): void {
  console.log(`🧹 Cleaning logs older than ${daysToKeep} days...`);
  
  const logFiles = getLogFiles();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  let totalSizeFreed = 0;
  let filesRemoved = 0;

  for (const file of logFiles) {
    if (file.modified < cutoffDate) {
      try {
        fs.unlinkSync(file.path);
        totalSizeFreed += file.size;
        filesRemoved++;
        console.log(`🗑️  Removed: ${file.name} (${formatBytes(file.size)})`);
      } catch (error) {
        console.error(`❌ Failed to remove ${file.name}:`, error);
      }
    }
  }

  console.log(`✅ Cleanup complete: ${filesRemoved} files removed, ${formatBytes(totalSizeFreed)} freed`);
}

function showLogStats(): void {
  console.log('📊 Log Files Statistics:');
  console.log('========================');
  
  const logFiles = getLogFiles();
  
  if (logFiles.length === 0) {
    console.log('No log files found');
    return;
  }

  let totalSize = 0;
  
  for (const file of logFiles) {
    totalSize += file.size;
    console.log(`${file.name.padEnd(30)} ${formatBytes(file.size).padStart(10)} ${file.modified.toISOString().split('T')[0]}`);
  }
  
  console.log('========================');
  console.log(`Total: ${formatBytes(totalSize)} across ${logFiles.length} files`);
}

function backupCurrentLogs(): void {
  console.log('💾 Creating backup of current logs...');
  
  const logFiles = getLogFiles();
  const backupDir = path.join(LOGS_DIR, 'backup-' + new Date().toISOString().split('T')[0]);
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  for (const file of logFiles) {
    if (file.name.endsWith('.log')) {
      const backupPath = path.join(backupDir, file.name);
      try {
        fs.copyFileSync(file.path, backupPath);
        console.log(`📋 Backed up: ${file.name}`);
      } catch (error) {
        console.error(`❌ Failed to backup ${file.name}:`, error);
      }
    }
  }
  
  console.log(`✅ Backup completed in: ${backupDir}`);
}

// CLI argument parsing
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'stats':
    showLogStats();
    break;
    
  case 'clean':
    const days = parseInt(args[1]) || 7;
    cleanOldLogs(days);
    break;
    
  case 'backup':
    backupCurrentLogs();
    break;
    
  case 'help':
  default:
    console.log(`
📋 Log Management Script

Usage:
  npm run clean-logs [command] [options]

Commands:
  stats                    Show log file statistics
  clean [days]            Clean logs older than N days (default: 7)
  backup                   Create backup of current logs
  help                     Show this help message

Examples:
  npm run clean-logs stats
  npm run clean-logs clean 14
  npm run clean-logs backup
`);
    break;
}