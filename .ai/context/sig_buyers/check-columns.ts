import { PrismaClient } from '@prisma/client';

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
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();

