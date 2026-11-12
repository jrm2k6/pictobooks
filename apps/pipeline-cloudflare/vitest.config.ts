import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-11-08",
        d1Databases: ["PIPELINE_DB"],
        r2Buckets: ["PIPELINE_ARTIFACTS"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          R2_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
          R2_BUCKET: "test-bucket",
          R2_ACCESS_KEY_ID: "test-access-key",
          R2_SECRET_ACCESS_KEY: "test-secret-key",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
