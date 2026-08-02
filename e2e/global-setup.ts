import { execSync } from "node:child_process";

/** e2e 全局准备：重置 dev.db 并重新播种，保证用例确定性。 */
export default function globalSetup() {
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "inherit",
  });
  execSync("node --experimental-strip-types prisma/seed.ts", {
    stdio: "inherit",
  });
}
