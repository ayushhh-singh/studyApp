/**
 * F4 journal editor — create (journal/new) and edit (journal/:entryId/edit).
 * Rich-text-lite (markdown: bold + bullet list) in a plain textarea, a mood tag,
 * free tags, an optional guided prompt, and localStorage draft autosave so an
 * interrupted entry is never lost. Bodies are sent to the API which encrypts
 * them at rest; nothing is logged.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, Bold, List, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useCreateJournalEntry,
  useJournalEntry,
  useUpdateJournalEntry,
} from "@/sukoon/lib/use-sukoon-journal";
import {
  MoodPicker,
  SignInPrompt,
  TagInput,
  usePromptText,
} from "@/sukoon/components/journal/journal-ui";
import { PromptPicker } from "@/sukoon/components/journal/prompt-picker";
import type { SukoonJournalPrompt } from "@neev/shared";

interface DraftShape {
  body: string;
  mood: number | null;
  tags: string[];
  promptId: string | null;
}

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { locale, entryId } = useParams<{ locale?: string; entryId?: string }>();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const promptText = usePromptText();
  const base = locale ? `/${locale}/sukoon` : "";
  const isEdit = !!entryId;
  const draftKey = `sukoon-journal-draft:${entryId ?? "new"}`;

  const entryQuery = useJournalEntry(entryId, { enabled: !!session && isEdit });
  const createMut = useCreateJournalEntry();
  const updateMut = useUpdateJournalEntry(entryId ?? "");

  const [body, setBody] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<SukoonJournalPrompt | null>(
    (location.state as { prompt?: SukoonJournalPrompt } | null)?.prompt ?? null,
  );
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate: prefer a saved draft; else the server entry (edit); else empty (new).
  useEffect(() => {
    if (hydrated) return;
    if (isEdit && !entryQuery.data) return; // wait for the entry to load first
    let draft: DraftShape | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) draft = JSON.parse(raw) as DraftShape;
    } catch {
      draft = null;
    }
    if (draft) {
      setBody(draft.body);
      setMood(draft.mood);
      setTags(draft.tags);
      setDraftRestored(true);
    } else if (isEdit && entryQuery.data) {
      const e = entryQuery.data.entry;
      setBody(e.body ?? "");
      setMood(e.mood);
      setTags(e.tags);
      setPrompt(e.prompt);
    }
    setHydrated(true);
  }, [hydrated, isEdit, entryQuery.data, draftKey]);

  // Autosave the draft (debounced) once hydrated and there's something to save.
  useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      const hasContent = body.trim().length > 0 || mood != null || tags.length > 0;
      if (!hasContent) {
        localStorage.removeItem(draftKey);
        return;
      }
      const draft: DraftShape = { body, mood, tags, promptId: prompt?.id ?? null };
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        /* storage full / unavailable — non-fatal */
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [body, mood, tags, prompt, hydrated, draftKey]);

  const canSave = body.trim().length > 0 || mood != null;
  const saving = createMut.isPending || updateMut.isPending;

  const onSave = async () => {
    if (!canSave || saving) return;
    const payload = {
      body: body.trim() ? body : undefined,
      mood: mood ?? null,
      tags,
    };
    try {
      let id = entryId;
      if (isEdit) {
        await updateMut.mutateAsync(payload);
      } else {
        const res = await createMut.mutateAsync({ ...payload, prompt_id: prompt?.id ?? null });
        id = res.entry.id;
      }
      localStorage.removeItem(draftKey);
      navigate(`${base}/journal/${id}`, { replace: true });
    } catch {
      /* mutation error is surfaced below via isError */
    }
  };

  // Markdown-lite helpers operating on the textarea selection.
  const wrapSelection = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e) || "";
    const next = `${value.slice(0, s)}${marker}${selected}${marker}${value.slice(e)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + marker.length, e + marker.length);
    });
  };
  const bulletSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const block = value.slice(lineStart, e);
    const bulleted = block
      .split("\n")
      .map((ln) => (ln.startsWith("- ") ? ln : `- ${ln}`))
      .join("\n");
    setBody(value.slice(0, lineStart) + bulleted + value.slice(e));
    requestAnimationFrame(() => el.focus());
  };

  // Check `loading` BEFORE `session` — see journal.tsx's identical comment;
  // for a NEW entry (isEdit=false) entryQuery is disabled too, so this bug
  // affected /journal/new the same way it affected the edit path.
  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  // Editing an entry that failed to load (deleted / not owner) → honest not-found
  // instead of a blank editor that would 404 on save.
  if (isEdit && entryQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" lang={language}>
        <p className="text-sm text-muted-foreground">{t("Sukoon.journal.listEmptyTitle")}</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link to={`${base}/journal`}>{t("Sukoon.journal.back")}</Link>
        </Button>
      </div>
    );
  }
  // Wait for the entry before showing the editor in edit mode (avoid a flash of
  // empty fields that then populate).
  if (isEdit && !hydrated) {
    return (
      <div className="mx-auto max-w-2xl space-y-3" lang={language}>
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" lang={language}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to={isEdit ? `${base}/journal/${entryId}` : `${base}/journal`}>
            <ArrowLeft className="size-4" />
            {t("Sukoon.journal.back")}
          </Link>
        </Button>
        <Button onClick={onSave} disabled={!canSave || saving} size="sm">
          {saving ? t("Sukoon.journal.saving") : t("Sukoon.journal.save")}
        </Button>
      </div>

      {prompt ? (
        <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("Sukoon.journal.writingOn")}
          </p>
          <p className="text-sm leading-relaxed text-foreground">{promptText(prompt)}</p>
          {!isEdit ? (
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("Sukoon.journal.removePrompt")}
            </button>
          ) : null}
        </div>
      ) : !isEdit ? (
        <PromptPicker
          onPick={setPrompt}
          trigger={
            <Button variant="outline" size="sm" className="self-start">
              <Sparkles className="size-4" />
              {t("Sukoon.journal.usePrompt")}
            </Button>
          }
        />
      ) : null}

      {draftRestored ? (
        <p className="text-xs text-muted-foreground">{t("Sukoon.journal.draftRestored")}</p>
      ) : null}

      {/* Editor */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <ToolbarButton label={t("Sukoon.journal.boldLabel")} onClick={() => wrapSelection("**")}>
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={t("Sukoon.journal.listLabel")} onClick={bulletSelection}>
            <List className="size-4" />
          </ToolbarButton>
        </div>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("Sukoon.journal.editorPlaceholder")}
          rows={10}
          className="min-h-[220px] w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-[1.9] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("Sukoon.journal.encryptedNote")}</p>

      {/* Mood */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("Sukoon.journal.moodOptional")}</p>
        <MoodPicker value={mood} onChange={setMood} />
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("Sukoon.journal.tagsLabel")}</p>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {(createMut.isError || updateMut.isError) && (
        <p className="text-sm text-destructive">{t("Sukoon.journal.needBodyOrMood")}</p>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
