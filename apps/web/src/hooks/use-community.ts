import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockResultResponseSchema,
  communityHubResponseSchema,
  discussionPostResponseSchema,
  discussionThreadDetailResponseSchema,
  discussionThreadResponseSchema,
  listBlocksResponseSchema,
  listDiscussionThreadsResponseSchema,
  listSharedAnswersResponseSchema,
  reportResultResponseSchema,
  sharedAnswerResponseSchema,
  voteResultResponseSchema,
  type CreateDiscussionPostBody,
  type CreateDiscussionThreadBody,
  type DiscussionAnchorType,
  type ReportContentBody,
  type UpdateDiscussionPostBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCommunityHub() {
  return useQuery({
    queryKey: queryKeys.communityHub(),
    queryFn: () => api.get("/api/v1/community/hub", communityHubResponseSchema),
  });
}

export function useCommunityThreads(anchorType: DiscussionAnchorType, anchorId: string, page = 1) {
  return useQuery({
    queryKey: queryKeys.communityThreads(anchorType, anchorId, page),
    queryFn: () =>
      api.get("/api/v1/community/threads", listDiscussionThreadsResponseSchema, {
        anchor_type: anchorType,
        anchor_id: anchorId,
        page,
      }),
    enabled: !!anchorId,
  });
}

export function useCommunityThread(threadId: string | undefined, page = 1) {
  return useQuery({
    queryKey: queryKeys.communityThread(threadId ?? "", page),
    queryFn: () =>
      api.get(`/api/v1/community/threads/${threadId}`, discussionThreadDetailResponseSchema, { page }),
    enabled: !!threadId,
  });
}

export function useCreateThread(anchorType: DiscussionAnchorType, anchorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDiscussionThreadBody) =>
      api.post("/api/v1/community/threads", discussionThreadResponseSchema, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "threads", anchorType, anchorId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.communityHub() });
    },
  });
}

export function useAddPost(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDiscussionPostBody) =>
      api.post(`/api/v1/community/threads/${threadId}/posts`, discussionPostResponseSchema, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "thread", threadId] });
    },
  });
}

export function useEditPost(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: string; body: UpdateDiscussionPostBody }) =>
      api.patch(`/api/v1/community/posts/${postId}`, discussionPostResponseSchema, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "thread", threadId] });
    },
  });
}

export function useDeletePost(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => api.delete(`/api/v1/community/posts/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "thread", threadId] });
    },
  });
}

export function useVotePost(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, value }: { postId: string; value: -1 | 1 }) =>
      api.post(`/api/v1/community/posts/${postId}/vote`, voteResultResponseSchema, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "thread", threadId] });
    },
  });
}

export function useSharedAnswers(page = 1) {
  return useQuery({
    queryKey: queryKeys.sharedAnswers(page),
    queryFn: () => api.get("/api/v1/community/shared-answers", listSharedAnswersResponseSchema, { page }),
  });
}

export function useSharedAnswer(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sharedAnswer(id ?? ""),
    queryFn: () => api.get(`/api/v1/community/shared-answers/${id}`, sharedAnswerResponseSchema),
    enabled: !!id,
  });
}

export function useShareAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (submissionId: string) =>
      api.post("/api/v1/community/shared-answers", sharedAnswerResponseSchema, { submission_id: submissionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "shared-answers"] });
    },
  });
}

export function useReportContent() {
  return useMutation({
    mutationFn: (body: ReportContentBody) =>
      api.post("/api/v1/community/reports", reportResultResponseSchema, body),
  });
}

export function useCommunityBlocks() {
  return useQuery({
    queryKey: queryKeys.communityBlocks(),
    queryFn: () => api.get("/api/v1/community/blocks", listBlocksResponseSchema),
  });
}

export function useBlockUser(threadId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockedUserId: string) =>
      api.post("/api/v1/community/blocks", blockResultResponseSchema, { blocked_user_id: blockedUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityBlocks() });
      if (threadId) queryClient.invalidateQueries({ queryKey: ["community", "thread", threadId] });
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockedUserId: string) => api.delete(`/api/v1/community/blocks/${blockedUserId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityBlocks() });
    },
  });
}
