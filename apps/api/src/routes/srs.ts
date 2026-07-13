import { Router } from "express";
import {
  createManualSrsCardBodySchema,
  createSrsCardFromCurrentAffairsFactBodySchema,
  createSrsCardFromEvaluationBodySchema,
  createSrsCardFromNodeBodySchema,
  createSrsCardFromQuestionBodySchema,
  listSrsCardsResponseSchema,
  seedRevisionResponseSchema,
  srsCardResponseSchema,
  srsCardsQuerySchema,
  srsDueQuerySchema,
  srsDueQueueResponseSchema,
  srsStatsResponseSchema,
  submitSrsReviewsBodySchema,
  submitSrsReviewsResponseSchema,
  updateSrsCardBodySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { touchFeature } from "../lib/feature-touch.js";
import {
  addCurrentAffairsFactToRevision,
  addEvaluationToRevision,
  addNodeToRevision,
  addQuestionToRevision,
  createManualCard,
  deleteCard,
  getDueQueue,
  getStats,
  listCards,
  seedNoteFacts,
  seedWrongAnswers,
  submitReviews,
  updateCard,
} from "../services/srs.js";

export const srsRouter = Router();
srsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));
// Every card-adding endpoint ("add to revision", manual create, the two seed
// endpoints) counts as touching the revision_srs feature — one middleware
// instead of a call at each of the 7 service functions that create a card.
srsRouter.use((req, _res, next) => {
  if (req.method === "POST" && (req.path.startsWith("/srs/cards") || req.path.startsWith("/srs/seed"))) {
    void touchFeature(currentUserId(), "revision_srs");
  }
  next();
});

srsRouter.post(
  "/srs/cards/from-node",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromNodeBodySchema, req.body);
    const card = await addNodeToRevision(currentUserId(), body.node_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards/from-question",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromQuestionBodySchema, req.body);
    const card = await addQuestionToRevision(currentUserId(), body.question_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards/from-evaluation",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromEvaluationBodySchema, req.body);
    const card = await addEvaluationToRevision(currentUserId(), body.submission_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards/from-current-affairs-fact",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromCurrentAffairsFactBodySchema, req.body);
    const card = await addCurrentAffairsFactToRevision(currentUserId(), body.item_id, body.fact_index);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.get(
  "/srs/due",
  asyncHandler(async (req, res) => {
    const query = parse(srsDueQuerySchema, req.query);
    const queue = await getDueQueue(currentUserId(), query.limit);
    res.json(srsDueQueueResponseSchema.parse({ data: queue, error: null }));
  }),
);

srsRouter.get(
  "/srs/stats",
  asyncHandler(async (req, res) => {
    const stats = await getStats(currentUserId());
    res.json(srsStatsResponseSchema.parse({ data: stats, error: null }));
  }),
);

srsRouter.post(
  "/srs/reviews",
  asyncHandler(async (req, res) => {
    const body = parse(submitSrsReviewsBodySchema, req.body);
    const results = await submitReviews(currentUserId(), body.reviews);
    res.status(201).json(submitSrsReviewsResponseSchema.parse({ data: { results }, error: null }));
  }),
);

srsRouter.get(
  "/srs/cards",
  asyncHandler(async (req, res) => {
    const query = parse(srsCardsQuerySchema, req.query);
    const result = await listCards(currentUserId(), { query: query.query, sourceType: query.source_type, page: query.page });
    res.json(listSrsCardsResponseSchema.parse({ data: result, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards",
  asyncHandler(async (req, res) => {
    const body = parse(createManualSrsCardBodySchema, req.body);
    const card = await createManualCard(currentUserId(), body.front_i18n, body.back_i18n);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.patch(
  "/srs/cards/:id",
  asyncHandler(async (req, res) => {
    const body = parse(updateSrsCardBodySchema, req.body);
    const card = await updateCard(currentUserId(), req.params.id, body);
    res.json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.delete(
  "/srs/cards/:id",
  asyncHandler(async (req, res) => {
    await deleteCard(currentUserId(), req.params.id);
    res.status(204).end();
  }),
);

srsRouter.post(
  "/srs/seed/wrong-answers",
  asyncHandler(async (req, res) => {
    const result = await seedWrongAnswers(currentUserId());
    res.status(201).json(seedRevisionResponseSchema.parse({ data: result, error: null }));
  }),
);

srsRouter.post(
  "/srs/seed/note-facts",
  asyncHandler(async (req, res) => {
    const result = await seedNoteFacts(currentUserId());
    res.status(201).json(seedRevisionResponseSchema.parse({ data: result, error: null }));
  }),
);
