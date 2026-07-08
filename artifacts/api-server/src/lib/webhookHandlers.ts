import { getStripeSync } from "./stripeClient";
import { dispatchBillingNotifications } from "./billingNotifications";

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Received type: " +
          typeof payload +
          ". " +
          "This usually means express.json() parsed the body before reaching this handler. " +
          "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // Signature verified & event synced above -- now send any billing
    // warning emails. Best-effort and fire-and-forget: email problems must
    // never fail webhook processing or delay the acknowledgement to Stripe.
    void dispatchBillingNotifications(payload);
  }
}
