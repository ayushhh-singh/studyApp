-- 0046_test_kind_time_attack.sql
-- CSAT Time Attack is a distinct rapid-fire game surface (its own /practice tab,
-- instant feedback, personal bests) so it gets its own test_kind rather than
-- masquerading as custom. Adding an enum value is its own migration (the new
-- value isn't usable in the same transaction it's added in).
alter type test_kind add value if not exists 'time_attack';
