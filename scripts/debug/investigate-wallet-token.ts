/**
 * Script to investigate wallet token data in the database
 * Helps debug missing tokens in holder profiles and drilldowns
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('InvestigateWalletToken');
const prisma = new PrismaClient();

async function investigateWalletToken(walletAddress: string, tokenMint?: string) {
  try {
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`Investigating Wallet: ${walletAddress}`);
    if (tokenMint) {
      logger.info(`Specific Token: ${tokenMint}`);
    }
    logger.info(`${'='.repeat(80)}\n`);

    // 1. Check if wallet exists
    const wallet = await prisma.wallet.findUnique({
      where: { address: walletAddress },
      include: {
        pnlSummary: true,
        behaviorProfile: true,
      },
    });

    if (!wallet) {
      logger.error(`❌ Wallet ${walletAddress} not found in database!`);
      return;
    }

    logger.info(`✅ Wallet found in database`);
    logger.info(`   Classification: ${wallet.classification || 'unknown'}`);
    logger.info(`   Analyzed Period: ${wallet.analyzedTimestampStart || 'N/A'} → ${wallet.analyzedTimestampEnd || 'N/A'}`);
    if (wallet.pnlSummary) {
      logger.info(`   PnL Summary exists: Net PnL = ${wallet.pnlSummary.netPnl?.toFixed(4)} SOL`);
    }
    if (wallet.behaviorProfile) {
      logger.info(`   Behavior Profile exists:`);
      const holdTimeTokenMap = wallet.behaviorProfile.holdTimeTokenMap as any;
      if (holdTimeTokenMap) {
        logger.info(`      holdTimeTokenMap keys: ${Object.keys(holdTimeTokenMap).join(', ')}`);
        if (tokenMint) {
          for (const [bucket, tokens] of Object.entries(holdTimeTokenMap)) {
            if (Array.isArray(tokens) && tokens.includes(tokenMint)) {
              logger.info(`      ✅ Token ${tokenMint} found in bucket: ${bucket}`);
            }
          }
        }
      } else {
        logger.warn(`      ⚠️ holdTimeTokenMap is null or undefined!`);
      }
    }

    // 2. Get SwapAnalysisInput records
    const swapInputs = await prisma.swapAnalysisInput.findMany({
      where: {
        walletAddress,
        ...(tokenMint ? { mint: tokenMint } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    logger.info(`\n📊 SwapAnalysisInput Records: ${swapInputs.length} total`);

    if (tokenMint) {
      logger.info(`   All records for token ${tokenMint}:`);
      swapInputs.forEach((input, idx) => {
        logger.info(`   [${idx + 1}] ${new Date(input.timestamp * 1000).toISOString()} | ${input.direction.toUpperCase()} | Amount: ${input.amount} | SOL: ${input.associatedSolValue} | Type: ${input.interactionType}`);
      });
    } else {
      // Group by mint
      const byMint = new Map<string, typeof swapInputs>();
      swapInputs.forEach((input) => {
        if (!byMint.has(input.mint)) {
          byMint.set(input.mint, []);
        }
        byMint.get(input.mint)!.push(input);
      });

      logger.info(`   Unique tokens: ${byMint.size}`);
      const sorted = Array.from(byMint.entries()).sort((a, b) => b[1].length - a[1].length);
      sorted.slice(0, 10).forEach(([mint, records]) => {
        logger.info(`   ${mint}: ${records.length} transfers`);
      });
    }

    // 3. Get AnalysisResult records
    const analysisResults = await prisma.analysisResult.findMany({
      where: {
        walletAddress,
        ...(tokenMint ? { tokenAddress: tokenMint } : {}),
      },
      orderBy: { lastTransferTimestamp: 'desc' },
    });

    logger.info(`\n📈 AnalysisResult Records: ${analysisResults.length} total`);

    if (tokenMint) {
      const result = analysisResults[0];
      if (result) {
        logger.info(`   Token: ${tokenMint}`);
        logger.info(`   Total Amount In: ${result.totalAmountIn}`);
        logger.info(`   Total Amount Out: ${result.totalAmountOut}`);
        logger.info(`   Net Amount: ${result.netAmountChange}`);
        logger.info(`   Total SOL Spent: ${result.totalSolSpent}`);
        logger.info(`   Total SOL Received: ${result.totalSolReceived}`);
        logger.info(`   Realized PnL: ${result.realizedPnlSol}`);
        logger.info(`   Unrealized PnL: ${result.unrealizedPnlSol}`);
        logger.info(`   Total PnL: ${result.totalPnlSol}`);
        logger.info(`   Transfer Count In: ${result.transferCountIn}`);
        logger.info(`   Transfer Count Out: ${result.transferCountOut}`);
        logger.info(`   First Transfer: ${result.firstTransferTimestamp ? new Date(result.firstTransferTimestamp * 1000).toISOString() : 'N/A'}`);
        logger.info(`   Last Transfer: ${result.lastTransferTimestamp ? new Date(result.lastTransferTimestamp * 1000).toISOString() : 'N/A'}`);
        logger.info(`   Current Balance: ${result.currentUiBalance}`);
        logger.info(`   Current Value (SOL): ${result.currentHoldingsValueSol}`);
        logger.info(`   Is Value Preservation: ${result.isValuePreservation}`);
      } else {
        logger.warn(`   ⚠️ No AnalysisResult found for token ${tokenMint}!`);
      }
    } else {
      logger.info(`   Showing top 10 by total PnL:`);
      const sorted = [...analysisResults].sort((a, b) => (b.totalPnlSol || 0) - (a.totalPnlSol || 0));
      sorted.slice(0, 10).forEach((result, idx) => {
        logger.info(`   [${idx + 1}] ${result.tokenAddress}: PnL=${result.totalPnlSol?.toFixed(4)} SOL | In=${result.transferCountIn} Out=${result.transferCountOut}`);
      });
    }

    // 4. Get TokenLot records (FIFO tracking)
    const tokenLots = await prisma.tokenLot.findMany({
      where: {
        walletAddress,
        ...(tokenMint ? { tokenAddress: tokenMint } : {}),
      },
      orderBy: { purchaseTimestamp: 'asc' },
    });

    logger.info(`\n💰 TokenLot Records (FIFO): ${tokenLots.length} total`);

    if (tokenMint) {
      logger.info(`   All lots for token ${tokenMint}:`);
      tokenLots.forEach((lot, idx) => {
        logger.info(`   [${idx + 1}] ${new Date(lot.purchaseTimestamp * 1000).toISOString()} | Bought: ${lot.amountBought.toString()} | Remaining: ${lot.amountRemaining.toString()} | Cost: ${lot.costBasisSol.toString()} SOL | Status: ${lot.status}`);
      });
    } else {
      const byToken = new Map<string, typeof tokenLots>();
      tokenLots.forEach((lot) => {
        if (!byToken.has(lot.tokenAddress)) {
          byToken.set(lot.tokenAddress, []);
        }
        byToken.get(lot.tokenAddress)!.push(lot);
      });

      logger.info(`   Unique tokens with lots: ${byToken.size}`);
      const sorted = Array.from(byToken.entries()).sort((a, b) => b[1].length - a[1].length);
      sorted.slice(0, 10).forEach(([token, lots]) => {
        logger.info(`   ${token}: ${lots.length} lots`);
      });
    }

    // 5. Check HolderProfileSnapshot
    const snapshots = await prisma.holderProfileSnapshot.findMany({
      where: { walletAddress },
      orderBy: { computedAt: 'desc' },
      take: 5,
    });

    logger.info(`\n📸 HolderProfileSnapshot Records: ${snapshots.length} recent snapshots`);
    if (snapshots.length > 0) {
      snapshots.forEach((snapshot, idx) => {
        const data = snapshot.profile as any;
        logger.info(`   [${idx + 1}] ${snapshot.computedAt.toISOString()} | Mode: ${snapshot.analysisMode} | TokenMint: ${snapshot.tokenMint || 'N/A'}`);
        logger.info(`       Profile Data: ${JSON.stringify(data, null, 2)}`);

        if (tokenMint && data?.tokenDetails) {
          const tokenDetail = data.tokenDetails.find((t: any) => t.tokenAddress === tokenMint);
          if (tokenDetail) {
            logger.info(`       ✅ Token ${tokenMint} found in snapshot!`);
            logger.info(`          Details: ${JSON.stringify(tokenDetail, null, 2)}`);
          } else {
            logger.warn(`       ⚠️ Token ${tokenMint} NOT in snapshot`);
            logger.warn(`          Available tokens: ${data.tokenDetails.map((t: any) => t.tokenAddress).slice(0, 5).join(', ')}`);
          }
        }
      });
    } else {
      logger.warn(`   ⚠️ No holder profile snapshots found!`);
    }

    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`Investigation Complete`);
    logger.info(`${'='.repeat(80)}\n`);

  } catch (error) {
    logger.error('Error investigating wallet:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const walletIndex = args.findIndex((arg) => arg === '-w' || arg === '--wallet');
const tokenIndex = args.findIndex((arg) => arg === '-t' || arg === '--token');

const walletAddress = walletIndex !== -1 ? args[walletIndex + 1] : args[0];
const tokenMint = tokenIndex !== -1 ? args[tokenIndex + 1] : undefined;

if (!walletAddress) {
  console.error('Usage: npm run investigate:wallet -- <walletAddress> [-t <tokenMint>]');
  console.error('       npm run investigate:wallet -- -w <walletAddress> [-t <tokenMint>]');
  process.exit(1);
}

investigateWalletToken(walletAddress, tokenMint);
