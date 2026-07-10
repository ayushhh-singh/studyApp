import { Router } from "express";
import { z } from "zod";
import {
  localeSchema,
  noteDeckResponseSchema,
  saveMentorNoteBodySchema,
  updateUserNoteBodySchema,
  userNoteListResponseSchema,
  userNoteResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import {
  addUserNoteDeckToRevision,
  deleteUserNote,
  getUserNote,
  listUserNotes,
  saveMessageAsNote,
  translateUserNote,
  updateUserNote,
} from "../services/user-notes.js";

/**
 * "My notes" — personal study material saved from a mentor answer. Every route
 * is scoped to currentUserId(); notes are private (owner-only RLS backs this up).
 */
export const userNotesRouter = Router();
userNotesRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const idParams = z.object({ id: z.string().uuid() });
const saveQuery = z.object({ locale: localeSchema.default("en") });
const listQuery = z.object({ node_id: z.string().uuid().optional() });

// Save an answer as a personal note (one structured conversion call → 201).
userNotesRouter.post(
  "/user-notes",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const body = parse(saveMentorNoteBodySchema, req.body);
    const { locale } = parse(saveQuery, req.query);
    const note = await saveMessageAsNote(currentUserId(), { messageId: body.message_id, nodeId: body.node_id }, locale);
    res.status(201).json(userNoteResponseSchema.parse({ data: note, error: null }));
  }),
);

userNotesRouter.get(
  "/user-notes",
  asyncHandler(async (req, res) => {
    const { node_id } = parse(listQuery, req.query);
    const items = await listUserNotes(currentUserId(), { nodeId: node_id });
    res.json(userNoteListResponseSchema.parse({ data: { items }, error: null }));
  }),
);

userNotesRouter.get(
  "/user-notes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const note = await getUserNote(currentUserId(), id);
    res.json(userNoteResponseSchema.parse({ data: note, error: null }));
  }),
);

userNotesRouter.patch(
  "/user-notes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateUserNoteBodySchema, req.body);
    const note = await updateUserNote(currentUserId(), id, body);
    res.json(userNoteResponseSchema.parse({ data: note, error: null }));
  }),
);

userNotesRouter.delete(
  "/user-notes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    await deleteUserNote(currentUserId(), id);
    res.status(204).end();
  }),
);

// On-demand translate (fills the empty locale — not automatic, costs a call).
userNotesRouter.post(
  "/user-notes/:id/translate",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const note = await translateUserNote(currentUserId(), id);
    res.json(userNoteResponseSchema.parse({ data: note, error: null }));
  }),
);

userNotesRouter.post(
  "/user-notes/:id/deck",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const result = await addUserNoteDeckToRevision(currentUserId(), id);
    res.json(noteDeckResponseSchema.parse({ data: result, error: null }));
  }),
);
