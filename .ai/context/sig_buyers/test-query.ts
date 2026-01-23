import { PrismaClient } from '@prisma/client';
import { getErrorMessage, getErrorDetails } from '../../../src/core/utils/error-utils';
import logger from '../../../src/core/utils/logger';



const prisma = new PrismaClient();

async function testQuery() {
  try {
    console.log('Testing cache query...\n');

    const result = await prisma.$queryRaw`
      SELECT
        mint,
        startBlockTime,
        endBlockTime,
        totalTransactions,
        jsonb_array_length(walletAddresses::jsonb) AS wallet_count,
        jsonb_array_length(transactions::jsonb) AS tx_count,
        processedAt
      FROM "SignificantBuyersCache"
      WHERE mint = '3wASZZHadqJDw2decXbBoM1qLMKmh3pCBXk9nArwpump'
      ORDER BY processedAt DESC
      LIMIT 3;
    `;

    console.table(result);

  } catch (error) {
    logger.error('Error:', getErrorMessage(error));
  } finally {
    await prisma.$disconnect();
  }
}

testQuery();

