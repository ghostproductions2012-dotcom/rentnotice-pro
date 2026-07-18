import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { WebhookHandlers } from "./lib/webhookHandlers";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind the Replit proxy: trust the first hop so req.ip reflects the real
// client (login rate limiting keys on it) instead of the proxy address.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        // Attorney case links carry a bearer-style token in the path; redact
        // it so live tokens never land in request logs.
        const path = req.url
          ?.split("?")[0]
          ?.replace(/(\/api\/attorney\/case\/)[^/]+/, "$1:token");
        return {
          id: req.id,
          method: req.method,
          url: path,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Stripe webhook must be registered BEFORE express.json() -- it needs the raw Buffer
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }

    try {
      const sig = Array.isArray(signature) ? signature[0]! : signature;

      if (!Buffer.isBuffer(req.body)) {
        logger.error(
          "STRIPE WEBHOOK ERROR: req.body is not a Buffer. " +
            "express.json() ran before this webhook route. " +
            "FIX: keep this route registered before app.use(express.json()).",
        );
        res.status(500).json({ error: "Webhook processing error" });
        return;
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error({ err: error }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(cors());
// Field evidence photos are relayed as data URLs, so allow large JSON bodies.
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// Central error handler -- report failures explicitly instead of hanging
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Attorney case links carry a bearer-style token in the path; redact it so
  // live tokens never land in error logs either.
  const url = req.url
    .split("?")[0]
    .replace(/(\/api\/attorney\/case\/)[^/]+/, "$1:token");
  logger.error({ err, url }, "Unhandled route error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error", code: "internal" });
});

export default app;
