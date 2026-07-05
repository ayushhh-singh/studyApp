import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default function Home() {
  const t = useTranslations("Landing");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="text-4xl font-bold sm:text-5xl">{t("title")}</h1>
        <p className="text-xl text-muted-foreground">{t("subtitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("description")}
        </p>
        <Button size="lg">{t("cta")}</Button>
      </main>
    </div>
  );
}
