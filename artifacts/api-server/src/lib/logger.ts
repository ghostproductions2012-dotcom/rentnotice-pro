import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// LOG_PRETTY=0 disables the pino-pretty transport. Needed by the esbuild-bundled
// seed scripts (post-merge): pino transports spawn a worker thread resolved via
// __dirname/package paths, which cannot work inside a single-file ESM bundle.
const prettyDisabled = process.env.LOG_PRETTY === "0";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || prettyDisabled
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
