import { PrismaClient } from '@prisma/client';
import { getErrorMessage, getErrorDetails } from '../../../../src/core/utils/error-utils';
import logger from '../../../../src/core/utils/logger';



const prisma = new PrismaClient();

async function checkColumns() {
  try {
    const columns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'SignificantBuyersCache'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    console.log('Database column names for SignificantBuyersCache:');
    (columns as any[]).forEach((col) => {
      console.log(`- ${col.column_name}`);
    });

  } catch (error) {
    logger.error('Error:', getErrorMessage(error));
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();

