import { Link } from "react-router";
import { Lock } from "lucide-react";
import type { SukoonExercise } from "@neev/shared";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { SUKOON_TOOL_ICONS, toolPlayerPath } from "@/sukoon/lib/tool-icons";

export function ExerciseCard({ exercise, base }: { exercise: SukoonExercise; base: string }) {
  const { language, t } = useSukoonLanguage();
  const Icon = SUKOON_TOOL_ICONS[exercise.type];
  const title = language === "hi" ? exercise.title_hi : exercise.title_en;
  const subtitle = t(`Sukoon.tools.type.${exercise.type}`);

  return (
    <Link
      to={`${base}/${toolPlayerPath(exercise.type, exercise.id)}`}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors duration-300",
        "hover:border-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-full bg-secondary/15 text-secondary">
          <Icon className="size-5" aria-hidden />
        </span>
        {exercise.locked ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {t("Sukoon.tools.premiumBadge")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </Link>
  );
}
