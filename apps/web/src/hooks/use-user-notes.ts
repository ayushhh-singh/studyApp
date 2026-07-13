import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  noteDeckResponseSchema,
  userNoteListResponseSchema,
  userNoteResponseSchema,
  type UpdateUserNoteBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useInvalidateSrs } from "@/hooks/use-srs";

/** Personal "My notes" — list (optionally scoped to a syllabus node). */
export function useUserNotes(nodeId?: string) {
  return useQuery({
    queryKey: queryKeys.userNotes(nodeId),
    queryFn: () =>
      api.get("/api/v1/user-notes", userNoteListResponseSchema, nodeId ? { node_id: nodeId } : undefined),
  });
}

/** One personal note (reader). */
export function useUserNote(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.userNote(id) : ["user-notes", "detail", "none"],
    queryFn: () => api.get(`/api/v1/user-notes/${id}`, userNoteResponseSchema),
    enabled: !!id,
  });
}

/** "Save as study material" — convert a mentor answer into a personal note. */
export function useSaveMentorNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, nodeId, locale }: { messageId: string; nodeId?: string | null; locale: string }) =>
      api.post(`/api/v1/user-notes?locale=${locale}`, userNoteResponseSchema, {
        message_id: messageId,
        ...(nodeId !== undefined ? { node_id: nodeId } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-notes"] }),
  });
}

export function useUpdateUserNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateUserNoteBody) => api.patch(`/api/v1/user-notes/${id}`, userNoteResponseSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-notes"] }),
  });
}

export function useDeleteUserNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/user-notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-notes"] }),
  });
}

/** Fill the empty locale on demand (never automatic — costs a model call). */
export function useTranslateUserNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/v1/user-notes/${id}/translate`, userNoteResponseSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userNote(id) });
      qc.invalidateQueries({ queryKey: ["user-notes"] });
    },
  });
}

/** Materialise this note's SRS candidate cards. */
export function useAddUserNoteDeck(id: string) {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: () => api.post(`/api/v1/user-notes/${id}/deck`, noteDeckResponseSchema),
    onSuccess: invalidate,
  });
}
