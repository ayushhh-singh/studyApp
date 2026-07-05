-- 0030_answer_images_bucket.sql
-- Storage bucket for handwritten-mode answer submissions. The web client
-- uploads compressed page photos directly to this bucket with the anon key
-- (avoids proxying multi-megabyte image bytes through the Express API); the
-- API only ever stores/reads the resulting storage paths and, server-side
-- with the service-role key (which bypasses RLS entirely), downloads the
-- bytes for OCR + vision grounding.
--
-- REPLACED IN AUTH PHASE (Session 15), same as 0013's dev-permissive table
-- RLS: this policy is wide open for anon + authenticated so the pre-auth dev
-- user can upload/read. Do NOT ship this to production.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('answer-images', 'answer-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy dev_permissive_answer_images on storage.objects
  for all
  to anon, authenticated
  using (bucket_id = 'answer-images')
  with check (bucket_id = 'answer-images');
