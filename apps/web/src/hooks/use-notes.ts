import { useMutation, useQuery } from "@tanstack/react-query";
import {
  noteDeckResponseSchema,
  noteDetailResponseSchema,
  noteRevisionResponseSchema,
  type NoteRevisionBody,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The published study note for a syllabus node (null if none). */
export function useNoteForNode(nodeId: string) {
  return useQuery({
    queryKey: queryKeys.noteForNode(nodeId),
    queryFn: () => api.get(`/api/v1/notes/node/${nodeId}`, noteDetailResponseSchema),
    enabled: !!nodeId,
  });
}

/** One-tap "add this note's deck" — materialise all SRS candidates. */
export function useAddNoteDeck() {
  return useMutation({
    mutationFn: (noteId: string) => api.post(`/api/v1/notes/${noteId}/deck`, noteDeckResponseSchema),
  });
}

/** Per-block "add to revision". */
export function useAddNoteBlock() {
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: NoteRevisionBody }) =>
      api.post(`/api/v1/notes/${noteId}/revision`, noteRevisionResponseSchema, body),
  });
}
