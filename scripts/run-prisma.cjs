const { spawnSync } = require("node:child_process");
const path = require("node:path");

function migrationEnvironment(env) {
  const directUrl = env.DIRECT_DATABASE_URL?.trim();
  return directUrl ? { ...env, DATABASE_URL: directUrl } : { ...env };
}

if (require.main === module) {
  const prismaPackage = require.resolve("prisma/package.json");
  const prismaEntry = path.join(path.dirname(prismaPackage), "build/index.js");
  const result = spawnSync(process.execPath, [prismaEntry, ...process.argv.slice(2)], {
    env: migrationEnvironment(process.env),
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

module.exports = { migrationEnvironment };
