import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale } from "@/lib/locale";

type HealthResponse = {
  data: { ok: boolean } | null;
  error: string | null;
};

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex gap-2">
        {SUPPORTED_LOCALES.map((l) => (
          <Button
            key={l}
            type="button"
            variant={l === locale ? "default" : "outline"}
            size="sm"
            onClick={() =>
              navigate(
                switchLocale(
                  location.pathname,
                  location.search,
                  l,
                  location.hash,
                ),
              )
            }
          >
            {l.toUpperCase()}
          </Button>
        ))}
      </div>

      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        {t("Landing.title")}
      </h1>
      <p className="text-lg text-muted-foreground">{t("Landing.subtitle")}</p>
      <p className="text-muted-foreground">{t("Landing.description")}</p>
      <Button type="button">{t("Landing.cta")}</Button>

      <div className="w-full rounded-md border p-4 text-left text-sm">
        <p className="font-medium">GET /api/v1/health</p>
        {health.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {health.isError && (
          <p className="text-destructive">Error: {(health.error as Error).message}</p>
        )}
        {health.data && (
          <pre className="mt-2 overflow-x-auto">
            {JSON.stringify(health.data, null, 2)}
          </pre>
        )}
      </div>
    </main>
  );
}
