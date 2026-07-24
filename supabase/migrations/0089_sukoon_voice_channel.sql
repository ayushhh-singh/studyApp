-- =============================================================================
-- 0089_sukoon_voice_channel.sql — F10 Voice Mode: tag which channel a message
-- came from.
--
-- sukoon_messages already carries every column a voice turn needs (role,
-- content = transcript/reply text, model_used, crisis_level) — the ONE thing
-- missing is a way to tell a voice turn apart from a typed one so a mixed
-- text+voice conversation's history can render each bubble with the right
-- affordance (e.g. a small mic glyph) without re-deriving it from content.
-- Additive, defaulted, so every existing row is implicitly 'text'.
-- =============================================================================

alter table public.sukoon_messages
  add column if not exists channel text not null default 'text'
    check (channel in ('text', 'voice'));
