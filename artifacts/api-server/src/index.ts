import { runMigrations } from "stripe-replit-sync";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { getStripeSync } from "./lib/stripeClient";
import { getTierPriceMismatches } from "./lib/stripeData";
import { healOwnerAdminAccount } from "./lib/ownerAdmin";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Initialize the Stripe schema, managed webhook, and data backfill.
 * Non-fatal: the API still serves auth/portal/license routes while the
 * Stripe integration is not yet connected -- but we log loudly so the
 * missing connection is impossible to miss.
 */
async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error(
      "DATABASE_URL is not set -- Stripe sync disabled. Create a PostgreSQL database.",
    );
    return;
  }

  try {
    logger.info("Initializing Stripe schema...");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    const webhookResult = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`,
    );
    logger.info(
      { webhook: webhookResult?.url ?? "setup complete" },
      "Stripe managed webhook configured",
    );

    // NOTE: syncBackfill() without params syncs nothing, and the incremental
    // syncProducts/syncPrices cursors are creation-time based, so updates to
    // existing objects (e.g. an archived price) are missed. After the
    // incremental sync, re-fetch any price the pricing guard flags so the
    // synced cache converges with live Stripe even when the webhook event
    // was missed.
    (async () => {
      await stripeSync.syncProducts();
      await stripeSync.syncPrices();
      const mismatches = await getTierPriceMismatches();
      for (const mismatch of mismatches) {
        if (!mismatch.livePriceId) continue;
        logger.info(
          { priceId: mismatch.livePriceId, reason: mismatch.reason },
          "Re-fetching flagged Stripe price from live Stripe",
        );
        await stripeSync.syncSingleEntity(mismatch.livePriceId);
      }
      logger.info("Stripe data synced");
    })().catch((err) => logger.error({ err }, "Error syncing Stripe data"));
  } catch (error) {
    logger.error(
      { err: error },
      "STRIPE NOT INITIALIZED -- checkout and billing will be unavailable until the Stripe integration is connected. Everything else keeps working.",
    );
  }
}

/**
 * Idempotent self-heal: migrate any legacy plaintext field-sync tokens to
 * hashed storage (token -> token_hash + token_suffix). Runs before serving
 * so a database created under the old schema keeps existing device codes
 * working without ever storing them in plaintext again.
 */
async function migrateFieldSyncTokenHashes(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'field_sync_tokens' AND column_name = 'token') THEN
          ALTER TABLE field_sync_tokens ADD COLUMN IF NOT EXISTS token_hash text;
          ALTER TABLE field_sync_tokens ADD COLUMN IF NOT EXISTS token_suffix text NOT NULL DEFAULT '';
          UPDATE field_sync_tokens
            SET token_hash = encode(sha256(convert_to(upper(trim(token)), 'UTF8')), 'hex'),
                token_suffix = right(upper(trim(token)), 4)
            WHERE token_hash IS NULL;
          ALTER TABLE field_sync_tokens ALTER COLUMN token_hash SET NOT NULL;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'field_sync_tokens_token_hash_unique') THEN
            ALTER TABLE field_sync_tokens
              ADD CONSTRAINT field_sync_tokens_token_hash_unique UNIQUE (token_hash);
          END IF;
          ALTER TABLE field_sync_tokens DROP COLUMN token;
        END IF;
      END
      $$;
    `);
  } catch (err) {
    logger.error(
      { err },
      "Failed to migrate field sync tokens to hashed storage",
    );
    throw err;
  }
}

await migrateFieldSyncTokenHashes();

// Idempotent owner-admin self-heal: provisions the owner master-admin account
// from secrets, deactivates the legacy admin@admin.com test login, and revokes
// Test Company license keys. This is the write path that reaches production
// data after a publish. Non-fatal so a transient DB error can't block boot.
try {
  await healOwnerAdminAccount();
} catch (err) {
  logger.error({ err }, "Owner admin self-heal failed (continuing to serve)");
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
