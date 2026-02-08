import { prisma } from '../../src/core/services/database-service';

interface TableSize {
  tableName: string;
  rowCount: number;
  totalSize: string;
  tableSize: string;
  indexesSize: string;
  totalSizeBytes: number;
}

async function getTableSizes(): Promise<TableSize[]> {
  // Use pg_class with proper OID references to avoid case sensitivity issues
  const sizes = await prisma.$queryRaw<Array<{
    tableName: string;
    totalSize: string;
    tableSize: string;
    indexesSize: string;
    totalSizeBytes: bigint;
  }>>`
    SELECT 
      c.relname AS "tableName",
      pg_size_pretty(pg_total_relation_size(c.oid)) AS "totalSize",
      pg_size_pretty(pg_relation_size(c.oid)) AS "tableSize",
      pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS "indexesSize",
      pg_total_relation_size(c.oid) AS "totalSizeBytes"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC;
  `;

  // Get row counts for each table
  // Use a Set to track processed tables and avoid duplicates
  const seenTables = new Set<string>();
  const tableSizes: TableSize[] = [];
  
  for (const size of sizes) {
    const tableName = size.tableName;
    
    // Skip if we've already processed this table
    if (seenTables.has(tableName)) {
      continue;
    }
    seenTables.add(tableName);
    
    try {
      // Properly quote the table name to handle case sensitivity
      // Escape any existing quotes in the table name
      const escapedTableName = tableName.replace(/"/g, '""');
      const rowCountQuery = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint as count FROM public."${escapedTableName}"`
      );
      const rowCount = Number(rowCountQuery[0]?.count || 0);

      tableSizes.push({
        tableName,
        rowCount,
        totalSize: size.totalSize,
        tableSize: size.tableSize,
        indexesSize: size.indexesSize,
        totalSizeBytes: Number(size.totalSizeBytes),
      });
    } catch (error) {
      // Skip tables that can't be queried (e.g., views or permission issues)
      console.warn(`Warning: Could not get row count for table "${tableName}": ${error}`);
      // Still add the table with 0 rows so we can see the size
      tableSizes.push({
        tableName,
        rowCount: 0,
        totalSize: size.totalSize,
        tableSize: size.tableSize,
        indexesSize: size.indexesSize,
        totalSizeBytes: Number(size.totalSizeBytes),
      });
    }
  }

  return tableSizes;
}

async function getDatabaseTotalSize(): Promise<string> {
  const result = await prisma.$queryRaw<Array<{ size: string }>>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size;
  `;
  return result[0]?.size || 'Unknown';
}

async function main(): Promise<void> {
  try {
    console.log('📊 PostgreSQL Database Size Analysis\n');
    console.log('='.repeat(80));

    const totalSize = await getDatabaseTotalSize();
    console.log(`\nTotal Database Size: ${totalSize}\n`);

    const tableSizes = await getTableSizes();

    if (tableSizes.length === 0) {
      console.log('No tables found.');
      return;
    }

    // Calculate totals
    const totalRows = tableSizes.reduce((sum, t) => sum + t.rowCount, 0);
    const totalBytes = tableSizes.reduce((sum, t) => sum + t.totalSizeBytes, 0);
    const totalTableBytes = tableSizes.reduce((sum, t) => {
      // Parse table size string to bytes
      const sizeStr = t.tableSize;
      const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
      if (!match) return sum;
      const value = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
      return sum + (value * (multipliers[unit] || 1));
    }, 0);
    const totalIndexBytes = tableSizes.reduce((sum, t) => {
      const sizeStr = t.indexesSize;
      const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
      if (!match) return sum;
      const value = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
      return sum + (value * (multipliers[unit] || 1));
    }, 0);
    
    const totalSizeFormatted = formatBytes(totalBytes);
    const indexOverheadPercent = totalBytes > 0 ? ((totalIndexBytes / totalBytes) * 100).toFixed(1) : '0.0';
    const avgBytesPerRow = totalRows > 0 ? (totalTableBytes / totalRows).toFixed(2) : '0';

    console.log(`Total Tables: ${tableSizes.length}`);
    console.log(`Total Rows: ${totalRows.toLocaleString()}`);
    console.log(`Total Size: ${totalSizeFormatted}`);
    console.log(`  └─ Table Data: ${formatBytes(totalTableBytes)} (${((totalTableBytes / totalBytes) * 100).toFixed(1)}%)`);
    console.log(`  └─ Indexes: ${formatBytes(totalIndexBytes)} (${indexOverheadPercent}%)`);
    console.log(`  └─ Avg Bytes/Row: ${avgBytesPerRow} bytes\n`);

    // Display table breakdown
    console.log('Table Size Breakdown (sorted by size):');
    console.log('-'.repeat(95));
    console.log(
      `${'Table Name'.padEnd(30)} ${'Rows'.padStart(10)} ${'B/Row'.padStart(8)} ${'Table'.padStart(10)} ${'Idx'.padStart(10)} ${'Total'.padStart(10)} ${'Idx%'.padStart(6)}`
    );
    console.log('-'.repeat(95));

    for (const table of tableSizes) {
      const percentage = totalBytes > 0 ? ((table.totalSizeBytes / totalBytes) * 100).toFixed(1) : '0.0';
      
      // Calculate bytes per row
      const tableSizeMatch = table.tableSize.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
      let bytesPerRow = 'N/A';
      if (tableSizeMatch && table.rowCount > 0) {
        const value = parseFloat(tableSizeMatch[1]);
        const unit = tableSizeMatch[2].toUpperCase();
        const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
        const tableBytes = value * (multipliers[unit] || 1);
        bytesPerRow = (tableBytes / table.rowCount).toFixed(0);
      }
      
      // Calculate index overhead percentage
      const indexSizeMatch = table.indexesSize.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
      const totalSizeMatch = table.totalSize.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
      let idxPercent = 'N/A';
      if (indexSizeMatch && totalSizeMatch) {
        const idxValue = parseFloat(indexSizeMatch[1]);
        const idxUnit = indexSizeMatch[2].toUpperCase();
        const totalValue = parseFloat(totalSizeMatch[1]);
        const totalUnit = totalSizeMatch[2].toUpperCase();
        const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
        const idxBytes = idxValue * (multipliers[idxUnit] || 1);
        const totalTableBytes = totalValue * (multipliers[totalUnit] || 1);
        if (totalTableBytes > 0) {
          idxPercent = ((idxBytes / totalTableBytes) * 100).toFixed(0);
        }
      }
      
      console.log(
        `${table.tableName.padEnd(30)} ${table.rowCount.toLocaleString().padStart(10)} ${bytesPerRow.padStart(8)} ${table.tableSize.padStart(10)} ${table.indexesSize.padStart(10)} ${table.totalSize.padStart(10)} ${idxPercent.padStart(5)}%`
      );
    }

    console.log('-'.repeat(95));
    console.log(
      `${'TOTAL'.padEnd(30)} ${totalRows.toLocaleString().padStart(10)} ${avgBytesPerRow.padStart(8)} ${formatBytes(totalTableBytes).padStart(10)} ${formatBytes(totalIndexBytes).padStart(10)} ${totalSizeFormatted.padStart(10)} ${indexOverheadPercent.padStart(5)}%`
    );
  } catch (error) {
    console.error('Error checking database size:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

main();
