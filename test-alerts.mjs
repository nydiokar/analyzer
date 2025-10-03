#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  console.log('🔍 Testing Alerts System\n');

  // 1. Find or create a test user
  let user = await prisma.user.findFirst({ where: { isDemo: true } });
  if (!user) {
    user = await prisma.user.findFirst();
  }
  if (!user) {
    console.error('❌ No users found in database. Please create a user first.');
    process.exit(1);
  }

  console.log(`✅ Using user: ${user.id} (${user.description || 'No description'})`);

  // 2. Find a token with price data
  const token = await prisma.tokenInfo.findFirst({
    where: {
      priceUsd: { not: null },
    },
  });

  if (!token) {
    console.error('❌ No tokens with price data found.');
    process.exit(1);
  }

  const currentPrice = parseFloat(token.priceUsd || '0');
  console.log(`✅ Using token: ${token.symbol || token.tokenAddress} - Current price: $${currentPrice}`);

  // 3. Create a test alert that SHOULD trigger
  const targetPrice = currentPrice * 0.9; // Set threshold below current price
  console.log(`\n📝 Creating alert: "Notify when price goes above $${targetPrice.toFixed(8)}"`);

  const alert = await prisma.tokenAlert.create({
    data: {
      userId: user.id,
      tokenAddress: token.tokenAddress,
      label: 'Test Alert (Should Trigger)',
      condition: {
        type: 'price',
        operator: 'gt',
        value: targetPrice,
        field: 'priceUsd',
      },
      channels: ['in_app'],
      cooldownMinutes: 1, // Short cooldown for testing
      isActive: true,
    },
  });

  console.log(`✅ Alert created: ${alert.id}`);

  // 4. Manually evaluate (simulate the cron job)
  console.log(`\n⏳ Evaluating alert...`);

  const shouldTrigger = currentPrice > targetPrice;
  console.log(`   Current price: $${currentPrice}`);
  console.log(`   Target price: $${targetPrice.toFixed(8)}`);
  console.log(`   Should trigger: ${shouldTrigger ? '✅ YES' : '❌ NO'}`);

  if (shouldTrigger) {
    // Create notification
    const notification = await prisma.alertNotification.create({
      data: {
        alertId: alert.id,
        userId: user.id,
        snapshot: {
          tokenAddress: token.tokenAddress,
          symbol: token.symbol,
          priceUsd: currentPrice,
          timestamp: new Date().toISOString(),
        },
        delivered: true,
      },
    });

    // Update alert
    await prisma.tokenAlert.update({
      where: { id: alert.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 },
      },
    });

    console.log(`\n🔔 Alert triggered! Notification created: ${notification.id}`);
  }

  // 5. Show results
  const notifications = await prisma.alertNotification.findMany({
    where: { userId: user.id },
    include: { Alert: { include: { TokenInfo: true } } },
    orderBy: { triggeredAt: 'desc' },
    take: 5,
  });

  console.log(`\n📬 Recent notifications (${notifications.length}):`);
  notifications.forEach(n => {
    const symbol = n.Alert.TokenInfo?.symbol || 'Unknown';
    const price = n.snapshot?.priceUsd || 'N/A';
    console.log(`   - ${symbol}: $${price} (${new Date(n.triggeredAt).toLocaleString()})`);
  });

  console.log('\n✅ Test complete!');
  console.log('\nNext steps:');
  console.log('1. Start backend: npm run dev');
  console.log('2. Check logs for cron job execution (every 5 min)');
  console.log(`3. Query notifications: GET /api/v1/alerts/notifications/list?userId=${user.id}`);

  await prisma.$disconnect();
}

test().catch(console.error);
