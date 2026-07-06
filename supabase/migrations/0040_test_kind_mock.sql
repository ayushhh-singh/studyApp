-- 0040_test_kind_mock.sql
-- Full-length mock tests are a distinct surface (their own /practice tab + a
-- cutoff-comparison result), so they get their own test_kind value rather than
-- masquerading as pyq_full. Adding an enum value is its own migration (the new
-- value isn't usable in the same transaction it's added in).
alter type test_kind add value if not exists 'mock';
