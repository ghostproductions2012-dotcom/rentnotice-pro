import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/api/impl";

// ---------------------------------------------------------------------------
// Startup safety net: no failure may ever produce a silent empty screen.
// 1. A top-level React error boundary catches render-time crashes.
// 2. Global error / unhandledrejection handlers catch everything outside
//    React (async boot code, event handlers) and paint a plain-DOM fallback
//    if the app has nothing visible on screen (React itself may be dead).
// ---------------------------------------------------------------------------

function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n\n${err.stack}` : err.message;
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Plain-DOM fatal screen used when React may not be functioning. */
function showFatalOverlay(err: unknown): void {
  if (document.getElementById("fatal-error-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "fatal-error-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#f8fafc;color:#0f172a;" +
    "font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;";
  const box = document.createElement("div");
  box.style.cssText = "max-width:560px;width:100%;";
  const title = document.createElement("h1");
  title.textContent = "RentNotice Pro hit an unexpected error";
  title.style.cssText = "font-size:20px;margin:0 0 8px;";
  const hint = document.createElement("p");
  hint.textContent = "Your data has not been changed. Restarting the app usually fixes this.";
  hint.style.cssText = "margin:0 0 12px;color:#475569;font-size:14px;";
  const pre = document.createElement("pre");
  pre.textContent = describeError(err);
  pre.style.cssText =
    "background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:12px;" +
    "font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;margin:0 0 16px;";
  const button = document.createElement("button");
  button.textContent = "Reload app";
  button.style.cssText =
    "background:#0f172a;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:14px;cursor:pointer;";
  button.addEventListener("click", () => window.location.reload());
  box.append(title, hint, pre, button);
  overlay.append(box);
  document.body.append(overlay);
}

function appHasVisibleContent(): boolean {
  const root = document.getElementById("root");
  return !!root && root.childElementCount > 0;
}

window.addEventListener("error", (event) => {
  console.error("[global error]", event.error ?? event.message);
  // Only take over the screen when nothing rendered — otherwise the in-app
  // error surfaces (error boundary, startup error screen, toasts) handle it.
  if (!appHasVisibleContent()) showFatalOverlay(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled rejection]", event.reason);
  if (!appHasVisibleContent()) showFatalOverlay(event.reason);
});

interface ErrorBoundaryState {
  error: unknown;
}

class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[error boundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: 560, width: "100%" }}>
            <h1 style={{ fontSize: 20, margin: "0 0 8px" }} data-testid="text-crash-title">
              RentNotice Pro hit an unexpected error
            </h1>
            <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 14 }}>
              Your data has not been changed. Reloading the app usually fixes this.
            </p>
            <pre
              style={{
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: 12,
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 240,
                overflow: "auto",
                margin: "0 0 16px",
              }}
              data-testid="text-crash-details"
            >
              {describeError(this.state.error)}
            </pre>
            <button
              style={{
                background: "#0f172a",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                padding: "10px 18px",
                fontSize: 14,
                cursor: "pointer",
              }}
              onClick={() => window.location.reload()}
              data-testid="button-crash-reload"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
