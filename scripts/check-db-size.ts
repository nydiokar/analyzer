import { PrismaClient } from '@prisma/client';
import { getErrorMessage, getErrorDetails } from '../src/core/utils/error-utils';
import logger from '../src/core/utils/logger';



const prisma = new PrismaClient();

async function checkTableIndexes(tableName: string) {
  const indexes = await prisma.$queryRaw<
    Array<{
      indexname: string;
      indexdef: string;
      size: string;
    }>
  >`
    SELECT
      i.indexname,
      i.indexdef,
      pg_size_pretty(pg_relation_size(quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))) AS size
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = ${tableName}
    ORDER BY pg_relation_size(quote_ident(i.schemaname)||'.'||quote_ident(i.indexname)) DESC;
  `;

  if (indexes.length > 0) {
    console.log(`\n=== INDEXES FOR ${tableName} ===\n`);
    console.table(indexes);
  }
}

async function checkDatabaseSize(showIndexes = false) {
  try {
    console.log('\n=== DATABASE SIZE REPORT ===\n');

    // Get total database size
    const dbSizeResult = await prisma.$queryRaw<Array<{ pg_size_pretty: string }>>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as pg_size_pretty;
    `;
    console.log(`Total Database Size: ${dbSizeResult[0].pg_size_pretty}\n`);

    // Get size by tables
    console.log('=== SIZE BY TABLE ===\n');
    const tableSizes = await prisma.$queryRaw<
      Array<{
        table: string;
        row_count: string;
        table_size: string;
        indexes_size: string;
        total_size: string;
      }>
    >`
      SELECT
        c.relname AS table,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
        pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS indexes_size,
        to_char(c.reltuples, 'FM999,999,999,999') AS row_count
      FROM pg_class c
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC;
    `;

    console.table(tableSizes);

    console.log('\n=== SUMMARY ===');
    console.log(`Number of tables: ${tableSizes.length}`);

    // Show index details if requested
    if (showIndexes) {
      const topTables = tableSizes.slice(0, 3).map(t => t.table);
      for (const table of topTables) {
        await checkTableIndexes(table);
      }
    }

  } catch (error) {
    logger.error('Error checking database size:', getErrorMessage(error));
  } finally {
    await prisma.$disconnect();
  }
}

// Check if --indexes flag is passed
const showIndexes = process.argv.includes('--indexes');
checkDatabaseSize(showIndexes);
