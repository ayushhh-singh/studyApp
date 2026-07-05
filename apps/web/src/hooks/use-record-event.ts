import { useMutation } from "@tanstack/react-query";
import { eventResponseSchema, type EventBody } from "@prayasup/shared";
import { api } from "@/lib/api";

export function useRecordEvent() {
  return useMutation({
    mutationFn: (body: EventBody) => api.post("/api/v1/events", eventResponseSchema, body),
  });
}
