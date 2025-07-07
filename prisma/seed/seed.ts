import { PrismaClient } from '../../build/generated/prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.donationTierDefinition.create({
    data: {
      name: 'SUPPORTER',
      description: 'Support InterChat and get a cool badge!',
      price: 1.99,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
