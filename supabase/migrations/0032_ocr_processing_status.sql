-- 0031_ocr_processing_status.sql
-- Adds 'ocr_processing' to submission_status so planOcr can atomically claim a
-- handwritten submission before transcribing it (the same status-guarded
-- UPDATE pattern planEvaluation already uses for 'evaluating') — closing a race
-- where two concurrent OCR requests for the same submission (two open tabs, or
-- a confirm-screen remount) would otherwise both call the vision model and
-- race on which transcription gets persisted.

alter type submission_status add value if not exists 'ocr_processing' after 'pending';
