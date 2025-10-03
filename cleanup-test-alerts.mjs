#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  const deleted = await prisma.tokenAlert.deleteMany({
    where: { label: { contains: 'Test Alert' } }
  });

  console.log(`Deleted ${deleted.count} test alerts`);
  await prisma.$disconnect();
}

cleanup().catch(console.error);
