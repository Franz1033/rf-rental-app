import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed rental items.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const rentalItems = [
  {
    id: "swan-pool-float",
    name: "Swan Pool Float",
    price: 120,
    damageFee: 1800,
    maxHours: 3,
    maxQuantity: 2,
    imageUrl: "/rental-items-images/Swan Pool Float.jpg",
    sortOrder: 1,
  },
  {
    id: "donut-pool-float",
    name: "Donut Pool Float",
    price: 0,
    damageFee: 1300,
    maxHours: 1,
    maxQuantity: 1,
    imageUrl: "/rental-items-images/Donut Pool Float.jpg",
    sortOrder: 2,
  },
];

async function main() {
  await Promise.all(
    rentalItems.map((item) =>
      prisma.rentalCatalogItem.upsert({
        where: { id: item.id },
        create: item,
        update: item,
      }),
    ),
  );

  console.log(`Seeded ${rentalItems.length} rental catalog items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
