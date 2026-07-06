import { Router } from "express";
import { z } from "zod";
import {
  noteDeckResponseSchema,
  noteDetailResponseSchema,
  noteRevisionBodySchema,
  noteRevisionResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { addNoteBlockToRevision, addNoteDeckToRevision, getNoteForNode } from "../services/notes.js";

export const notesRouter = Router();
notesRouter.use("/notes", rateLimit({ windowMs: 60_000, max: 120 }));

const nodeParams = z.object({ nodeId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });

/** The published note for a syllabus node (null if none) — the reader Notes tab. */
notesRouter.get(
  "/notes/node/:nodeId",
  asyncHandler(async (req, res) => {
    const { nodeId } = parse(nodeParams, req.params);
    const note = await getNoteForNode(nodeId);
    res.json(noteDetailResponseSchema.parse({ data: note, error: null }));
  }),
);

/** One-tap "add this note's deck" — materialise all SRS candidates. */
notesRouter.post(
  "/notes/:id/deck",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const result = await addNoteDeckToRevision(devUserId(), id);
    res.status(201).json(noteDeckResponseSchema.parse({ data: result, error: null }));
  }),
);

/** Per-block "add to revision" from the reader. */
notesRouter.post(
  "/notes/:id/revision",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(noteRevisionBodySchema, req.body);
    const result = await addNoteBlockToRevision(devUserId(), id, body);
    res.status(201).json(noteRevisionResponseSchema.parse({ data: result, error: null }));
  }),
);
