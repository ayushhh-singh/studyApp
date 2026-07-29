-- Sukoon F6 — three instrumental MEDITATION SOUNDSCAPES (the blueprint's
-- "2-3 calm background tracks for meditation"). Reuses the exact idempotent
-- `key` upsert from 0084/0094 — no new schema, no new type, no code change:
-- these are ordinary `meditation`-type rows the existing guided-meditation
-- player renders, and a `soundscape` category label was added to the web i18n
-- (Sukoon.tools.meditation.category.soundscape, en+hi).
--
-- WHY these are different from the guided meditations: they carry no spoken
-- narration — they are language-neutral instrumental beds, so the SAME audio
-- file serves both hi and en (audio_hi == audio_en). That is set by the audio
-- upload step (apps/api/scripts/sukoon-upload-audio.ts), NOT here — mirroring
-- 0084's operator-upload contract: seed the row now, point audio_hi/audio_en at
-- the real Storage path once the file is uploaded. Re-running this migration is
-- safe (the upsert below never touches audio_hi/audio_en, so a later-set path
-- is preserved). Until the upload runs, the player shows the honest "audio not
-- ready yet" state — never a broken player.
--
-- FREE (premium=false): a genuine taste of real audio for every user at beta,
-- and a distinct category from the premium guided-narration library.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

insert into public.sukoon_exercises (key, type, title_hi, title_en, config_json, premium, sort) values

($t$sound_deep_calm$t$, $t$meditation$t$,
 $t$गहरी शांति$t$, $t$Deep Calm$t$,
 $j${"category":"soundscape","duration_min":5}$j$::jsonb, false, 70),

($t$sound_morning_light$t$, $t$meditation$t$,
 $t$सुबह की रोशनी$t$, $t$Morning Light$t$,
 $j${"category":"soundscape","duration_min":5}$j$::jsonb, false, 71),

($t$sound_ocean_drift$t$, $t$meditation$t$,
 $t$सागर की लहरें$t$, $t$Ocean Drift$t$,
 $j${"category":"soundscape","duration_min":5}$j$::jsonb, false, 72)

on conflict (key) where key is not null do update set
  type        = excluded.type,
  title_hi    = excluded.title_hi,
  title_en    = excluded.title_en,
  config_json = excluded.config_json,
  premium     = excluded.premium,
  sort        = excluded.sort;
