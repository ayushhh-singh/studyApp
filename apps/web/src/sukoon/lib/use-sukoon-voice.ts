/**
 * F10 Voice Mode data hooks — TanStack Query over /api/sukoon/voice/*, same
 * conventions as use-sukoon-chat.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonVoiceTurnResponseSchema,
  sukoonVoiceUsageResponseSchema,
  type SukoonVoiceAudioMime,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The 60-minute-a-month meter — read by BOTH the Saathi entry point (to show
 *  the locked badge for free/plus) and the voice screen's meter ring. */
export function useVoiceUsage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonVoiceUsage(),
    queryFn: () => api.get("/api/sukoon/voice/usage", sukoonVoiceUsageResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

/** A recorded Blob → base64, without the "data:...;base64," prefix. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"));
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export interface VoiceTurnInput {
  conversationId: string | null;
  blob: Blob;
  mimeType: SukoonVoiceAudioMime;
  durationSeconds: number;
}

/** POST /voice/turn — one full record→transcript→reply→speech round trip. */
export function useVoiceTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VoiceTurnInput) => {
      const audio_base64 = await blobToBase64(input.blob);
      return api.post("/api/sukoon/voice/turn", sukoonVoiceTurnResponseSchema, {
        conversation_id: input.conversationId,
        audio_base64,
        mime_type: input.mimeType,
        duration_seconds: input.durationSeconds,
      });
    },
    onSettled: () => {
      // The meter changes on every real turn (and the entry point elsewhere
      // in the app reads the same query) — always refresh it, success or not,
      // since even a rejected-for-cap turn means the number shown was stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonVoiceUsage() });
    },
  });
}
