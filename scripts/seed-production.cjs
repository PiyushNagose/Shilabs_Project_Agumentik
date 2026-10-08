const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.log("Production database already initialized; skipping seed.");
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  const result = spawnSync("npm", ["run", "db:seed", "-w", "@shilabs/api"], {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error("Production database bootstrap failed", error);
  process.exit(1);
});
