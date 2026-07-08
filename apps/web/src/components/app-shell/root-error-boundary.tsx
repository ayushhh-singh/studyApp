import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The single outermost catch — react-router's own errorElement (see
 * app-error-boundary.tsx, wired per-route in router.tsx) handles everything
 * inside the router tree; this one only fires for failures outside it
 * (provider crashes, the router itself failing to construct). No i18n here
 * on purpose — i18next may not have initialized by the time this renders.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Root error boundary caught:", error, info);
    void import("@/lib/sentry-capture").then((m) => m.captureException(error));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "12px",
          padding: "24px",
          textAlign: "center",
          fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif",
          background: "#0D1526",
          color: "#F7F9FC",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", margin: 0 }}>Something went wrong — कुछ गड़बड़ हो गई</h1>
        <p style={{ color: "#9AA5B8", fontSize: "0.85rem", maxWidth: 360, margin: 0 }}>
          Please reload the page. If this keeps happening, try again in a few minutes.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "#2563EB",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            padding: "10px 20px",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
