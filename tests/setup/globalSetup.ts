import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Global setup: create a fresh SQLite schema in test.db before the suite so the
// integration tests run against a real database identical to production.
export default function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const dbPath = join(root, "prisma", "test.db");

  process.env.DATABASE_URL = "file:./test.db";

  if (existsSync(dbPath)) rmSync(dbPath);

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });

  return () => {
    // Teardown: remove the test db so runs stay hermetic.
    if (existsSync(dbPath)) rmSync(dbPath);
  };
}
