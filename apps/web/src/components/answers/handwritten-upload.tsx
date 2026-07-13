import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ChevronDown, ChevronUp, ImagePlus, RotateCw, X } from "lucide-react";
import { MAX_ANSWER_IMAGES } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AnswerPageImage {
  id: string;
  file: File;
  previewUrl: string;
  /** Baked into the pixels via canvas at upload time — this is a live preview only. */
  rotation: 0 | 90 | 180 | 270;
}

export function HandwrittenUpload({
  pages,
  onChange,
  disabled,
}: {
  pages: AnswerPageImage[];
  onChange: (pages: AnswerPageImage[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [overflowCount, setOverflowCount] = useState(0);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const selected = Array.from(fileList);
    // `accept="image/*"` on the input is only a UI hint — some pickers (e.g. a
    // desktop "All Files" override) can still hand back a non-image, which
    // would otherwise only fail late, inside the canvas rotation step at
    // submit time. Filter here so the rejection is immediate and visible.
    const images = selected.filter((f) => f.type.startsWith("image/"));
    setRejectedCount(selected.length - images.length);
    const room = MAX_ANSWER_IMAGES - pages.length;
    const files = images.slice(0, room);
    // A single picker action can select more valid images than remaining
    // room (e.g. picking 5 at once while already at 4/6) — previously the
    // extras beyond `room` were truncated with no message at all, since
    // rejectedCount only ever counted non-image files, not this case.
    setOverflowCount(images.length - files.length);
    const added: AnswerPageImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      rotation: 0,
    }));
    onChange([...pages, ...added]);
  }

  function removePage(id: string) {
    const page = pages.find((p) => p.id === id);
    if (page) URL.revokeObjectURL(page.previewUrl);
    onChange(pages.filter((p) => p.id !== id));
  }

  function rotatePage(id: string) {
    onChange(pages.map((p) => (p.id === id ? { ...p, rotation: (((p.rotation + 90) % 360) as 0 | 90 | 180 | 270) } : p)));
  }

  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  const atLimit = pages.length >= MAX_ANSWER_IMAGES;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("Answers.handwrittenUploadHint")}</p>

      {pages.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pages.map((page, index) => (
            <div key={page.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
              <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
                <img
                  src={page.previewUrl}
                  alt={t("Answers.handwrittenPageAlt", { number: index + 1 })}
                  className="size-full object-contain transition-transform"
                  style={{ transform: `rotate(${page.rotation}deg)` }}
                />
                <span className="absolute left-1.5 top-1.5 rounded-full bg-background/90 px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm">
                  {index + 1}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === 0}
                    onClick={() => movePage(index, -1)}
                    aria-label={t("Answers.handwrittenMoveUp")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === pages.length - 1}
                    onClick={() => movePage(index, 1)}
                    aria-label={t("Answers.handwrittenMoveDown")}
                  >
                    <ChevronDown />
                  </Button>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => rotatePage(page.id)}
                    aria-label={t("Answers.handwrittenRotate")}
                  >
                    <RotateCw />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => removePage(page.id)}
                    aria-label={t("Answers.handwrittenRemove")}
                    className="text-coral hover:text-coral"
                  >
                    <X />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || atLimit}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera aria-hidden />
          {t("Answers.handwrittenTakePhoto")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || atLimit}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus aria-hidden />
          {t("Answers.handwrittenChooseFiles")}
        </Button>
        <span className={cn("self-center text-xs text-muted-foreground", atLimit && "text-marigold")}>
          {t("Answers.handwrittenPageCount", { count: pages.length, max: MAX_ANSWER_IMAGES })}
        </span>
      </div>
      {rejectedCount > 0 && (
        <p className="text-xs text-coral">
          {t("Answers.handwrittenRejectedFiles", { count: rejectedCount })}
        </p>
      )}
      {overflowCount > 0 && (
        <p className="text-xs text-coral">
          {t("Answers.handwrittenOverflowFiles", { count: overflowCount, max: MAX_ANSWER_IMAGES })}
        </p>
      )}
    </div>
  );
}
