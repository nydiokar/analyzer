import { PrismaClient } from '@prisma/client';
import { createLogger } from 'core/utils/logger'; // Assuming logger path is correct

const prisma = new PrismaClient();
const logger = createLogger('DeleteWalletInputs');

const WALLET_TO_DELETE = '5xLyAv2VoKpc31HxMbi324MCZgsw4KN5GBMShAPmz6tf'; // <-- IMPORTANT: Replace this!

async function deleteInputs() {
  if (!WALLET_TO_DELETE) {
    logger.error('Please set the WALLET_TO_DELETE variable in the script.');
    return;
  }

  logger.warn(`Attempting to delete ALL SwapAnalysisInput records for wallet: ${WALLET_TO_DELETE}`);
  logger.warn('This operation is irreversible. Make sure you have backups if needed.');
  // Add a small delay or prompt if needed for safety
  // await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second delay

  try {
    const result = await prisma.swapAnalysisInput.deleteMany({
      where: {
        walletAddress: WALLET_TO_DELETE,
      },
    });

    logger.info(`Successfully deleted ${result.count} SwapAnalysisInput records for wallet ${WALLET_TO_DELETE}.`);

  } catch (error) {
    logger.error(`Error deleting SwapAnalysisInput records for wallet ${WALLET_TO_DELETE}`, { error });
  } finally {
    await prisma.$disconnect();
    logger.info('Database connection closed.');
  }
}

deleteInputs();