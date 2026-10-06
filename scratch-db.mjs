import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const runs = await prisma.integrationSyncRun.findMany({
    where: { totalRecords: 7 },
    orderBy: { startedAt: 'desc' },
  });
  console.log(JSON.stringify(runs, null, 2));
}

main().finally(() => prisma.$disconnect());
