import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PACKS = [
  { name: 'Starter', credits: 1000,   priceUsdc: 15  },
  { name: 'Builder', credits: 10000,  priceUsdc: 120 },
  { name: 'Pro',     credits: 100000, priceUsdc: 900 },
];

async function main() {
  for (const pack of PACKS) {
    const existing = await prisma.creditPack.findFirst({ where: { name: pack.name } });
    if (!existing) {
      await prisma.creditPack.create({ data: { ...pack, active: true } });
      console.log(`Created pack: ${pack.name} (${pack.credits} credits / $${pack.priceUsdc})`);
    } else {
      console.log(`Pack already exists: ${pack.name} — skipping`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
