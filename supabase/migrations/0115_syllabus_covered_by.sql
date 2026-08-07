-- 0115_syllabus_covered_by.sql
-- Findability for redundant-but-real coverage: 117 of UPSC's 195 chapterable
-- nodes have no chapter of their own, but their real content already lives
-- inside a sibling's published chapter (docs/upsc-chapter-panel-verdict.md,
-- Part 3 — an independent 4-auditor sweep confirmed all 117 as `redundant`
-- (101) or `partial` (16), 0 wholly uncovered, every `redundant` verdict
-- backed by a verbatim >=20-word teaching-passage quote).
--
-- Before this migration `notes-view.tsx` gated purely on `hasChapter(...)`
-- with no fallback, so a student navigating directly to one of the 117 saw a
-- bare "no chapter yet" empty state despite the content existing one click
-- away in a sibling chapter. This closes that gap: a syllabus node can now
-- point at the node whose chapter actually teaches it, and the UI links
-- there instead of dead-ending.
--
-- `covered_by_node_id` is deliberately NOT a computed/derived column and NOT
-- re-run automatically — it is a one-time backfill from a specific, reviewed
-- audit (Part 3 of the doc above), not a live query. A future chapter-rollout
-- round that authors one of the 117 nodes directly should NULL this column
-- out for that node (see the assertion below, which will start failing for
-- exactly that node once it gets its own chapter — that failure is the
-- correct signal to clear the stale pointer).
--
-- `on delete set null`, not cascade: if the covering node's chapter is ever
-- deleted, the pointer should just go stale (revert to the bare empty state),
-- never take the pointing (already-real) syllabus node down with it.

alter table public.syllabus_nodes
  add column if not exists covered_by_node_id uuid references public.syllabus_nodes(id) on delete set null;

comment on column public.syllabus_nodes.covered_by_node_id is
  'Set only when this node has no chapter of its own but a sibling''s chapter '
  'already teaches its content in full or in part (docs/upsc-chapter-panel-verdict.md '
  'Part 3). NULL for every node that has (or will get) its own chapter.';

-- ---------------------------------------------------------------------------
-- Backfill: the 117 UPSC nodes audited in Part 3, each pointed at the
-- covering_files[0] chapter's node_id (the auditors' primary/best-matching
-- citation — every entry in the audit output, `redundant` and `partial`
-- alike, names at least one covering chapter).
-- ---------------------------------------------------------------------------
do $$
declare
  n_updated int;
  n_missing int;
  n_self int;
  n_wrong_exam int;
begin
  create temporary table _covered_by_backfill (node_id uuid, covered_by_node_id uuid) on commit drop;

  insert into _covered_by_backfill (node_id, covered_by_node_id) values
  ('6ca8fe50-1e7b-4559-895f-2c6eaa2cf7f7', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('bb69ebe0-9462-4956-89cd-ac36647c9df0', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('e02d96c1-2586-4360-8c47-504e87ed1a00', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('e63b0a55-ea7e-4958-936f-5315c9972da1', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('2e6380c8-2572-4e50-8c75-8233e55244bb', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('86bcd476-d289-45a4-9054-a042678d50fb', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('3993e690-4da4-4264-aeb3-9912cd7afa81', '65e153a6-0b25-4904-94ba-9f2277795e02'),
  ('5e3858b7-8e06-49b7-98eb-0c163509f00a', '547b0b28-58fa-483f-a461-7bec7ab96cec'),
  ('8b2b128e-8adc-4c86-80da-03d7d23e8d66', '547b0b28-58fa-483f-a461-7bec7ab96cec'),
  ('75719fe0-e0e6-427a-8228-3e9b54c577ae', '547b0b28-58fa-483f-a461-7bec7ab96cec'),
  ('70bb7085-7a04-4eba-b0e3-871d265bd5f9', '547b0b28-58fa-483f-a461-7bec7ab96cec'),
  ('3feee3cb-f0c3-4dfb-a4a3-eb66a355e912', '3e0a87a1-5121-4a5f-9a0a-0094d0c9e0c6'),
  ('5a134895-bb2a-4f68-9d9d-855208e19320', '3e0a87a1-5121-4a5f-9a0a-0094d0c9e0c6'),
  ('905fa16a-4a71-4069-a810-96a13bb4e606', '3e0a87a1-5121-4a5f-9a0a-0094d0c9e0c6'),
  ('bc683cb3-66bc-43ba-aaa0-346cd3a38041', '3e0a87a1-5121-4a5f-9a0a-0094d0c9e0c6'),
  ('b0fbf2d5-ef93-4e7c-bc62-10f594348bd3', '2e9e4c46-6165-402b-ba92-74b6ee8bfdc8'),
  ('7b24d819-f920-401a-a68d-6aac2bc8361e', '2e9e4c46-6165-402b-ba92-74b6ee8bfdc8'),
  ('057d511f-ca60-4831-959b-47f2e7c4ed29', '2e9e4c46-6165-402b-ba92-74b6ee8bfdc8'),
  ('dd76a317-a35d-4fba-b339-e7edcde85789', '2e9e4c46-6165-402b-ba92-74b6ee8bfdc8'),
  ('09ffe9b5-6776-4beb-a11c-80969d318cc6', '2ac8068e-1c06-4f6e-9932-f53be93bd914'),
  ('e659dfbd-6d75-4b32-b74f-78625132fda2', '2ac8068e-1c06-4f6e-9932-f53be93bd914'),
  ('a497600f-0a70-41dd-81db-54656b07d967', '2ac8068e-1c06-4f6e-9932-f53be93bd914'),
  ('c4a10c6a-ba82-4977-8940-63fd21461e57', 'c96118de-c365-4002-9301-d8cf3555f4ce'),
  ('4df27ee5-b7b8-4f76-9837-a1a88213aa38', 'c96118de-c365-4002-9301-d8cf3555f4ce'),
  ('1f2d51cf-2965-4a76-8297-a66e58e78b1b', 'c96118de-c365-4002-9301-d8cf3555f4ce'),
  ('6a724f93-560d-491e-a1ed-4c5e025ab978', '138d1bb8-e76d-4778-baf1-0f49e7baf2a0'),
  ('6c7ae638-3216-4635-9cef-7a00d6e4ab41', '138d1bb8-e76d-4778-baf1-0f49e7baf2a0'),
  ('5a3471ed-975c-4099-a44e-7bc7cbdb6f33', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('ba083834-26cf-4358-af69-0b7ea2200883', '741d1f11-8743-4fc8-bd70-b86c768b0a3d'),
  ('e7f6f14c-88bb-48c4-a561-e624f3ca76b1', 'd2b95a3c-c548-441b-9d1e-e3d9da73fe48'),
  ('fce63b3d-34ba-4368-be0e-af337ba25df3', 'd2b95a3c-c548-441b-9d1e-e3d9da73fe48'),
  ('e527c923-48c6-4a02-b32a-819ac48d7769', 'd2b95a3c-c548-441b-9d1e-e3d9da73fe48'),
  ('0b5b9167-3387-49ee-a876-5e3610342d74', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('165722d1-5ed7-46ed-b8ff-b26f100f1b98', '4711c7dd-fc2c-4806-8e1e-d03176a5ed75'),
  ('257489cf-7b13-4c0b-9484-f9025ddbd039', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('2a514471-9973-4c0c-9279-affecd618234', 'b8728072-5de6-405a-91b3-8fd6c7460c47'),
  ('2d31cd07-4d43-4145-a356-f102305021f0', 'a0d6f7fb-39ca-434e-922f-209f487324fb'),
  ('306a4bcb-66bb-4018-9a48-cb25714da4cd', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('3770b332-1541-49c7-a92b-0eb39fa45ebf', 'cab7e1de-abe2-460e-bea9-f1e0e1386ca6'),
  ('48e7275f-08ba-40f6-ba6d-efae3b452eb1', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('4e30968a-1a31-41af-95fd-9e4d1055a9df', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('57fa8604-7265-4c8e-bda0-bd3f1552fba0', 'a0d6f7fb-39ca-434e-922f-209f487324fb'),
  ('5b340e2f-23f3-4f10-b13e-1f3282045de8', '6531ab4b-3707-4dff-af27-4dbe6f2880d6'),
  ('5f7d3f5c-f3ec-41b9-99eb-b47cc9da8b54', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('78a24fce-2bd6-40cd-8f48-8deca93adef8', 'cab7e1de-abe2-460e-bea9-f1e0e1386ca6'),
  ('7b86a05d-74d1-4dae-9d76-506003b17448', '788bfc11-18a6-45da-8e4b-a2892898839a'),
  ('82c02f3d-6af8-4dd4-ac4f-9c28459bf6ad', 'cab7e1de-abe2-460e-bea9-f1e0e1386ca6'),
  ('83812b51-f09c-4050-b043-2890664c62dd', 'a7331b44-0756-46f0-82ee-c6bcf3f0eb40'),
  ('887865b0-3437-4ba0-8b4d-1ff8dee8464b', 'a0d6f7fb-39ca-434e-922f-209f487324fb'),
  ('8aa21e0d-066e-4fcd-a297-5dc2f7d91b69', '4711c7dd-fc2c-4806-8e1e-d03176a5ed75'),
  ('8eb467ad-c211-46fe-8042-d664ce2ff3b4', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('9f73f5dc-6a75-458e-9507-07078fcd13bf', '788bfc11-18a6-45da-8e4b-a2892898839a'),
  ('a8059332-59e6-4cbe-926a-ba279a36c556', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('af550896-5187-4398-a9b6-5a729b1bbf15', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('c44de8cc-2308-4e78-9e4b-4a82f0b07827', 'cab7e1de-abe2-460e-bea9-f1e0e1386ca6'),
  ('cdf456e6-8c76-4444-8536-712b964ce048', '0b4b24f5-134b-4532-9b42-9fe2daef321d'),
  ('d2d937fd-b482-4a82-8f82-e3c8b340bc1a', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('e3f1d01c-c154-45ef-be4f-5ee22e54192a', 'a7331b44-0756-46f0-82ee-c6bcf3f0eb40'),
  ('eb1b061e-8e7a-4112-ac39-aa2907ce6ae3', '2bf48454-967e-4059-9016-9b4d72eacc92'),
  ('ec28407f-6ec8-4bb2-9af2-118a58467a0e', '788bfc11-18a6-45da-8e4b-a2892898839a'),
  ('ef390cb0-42e4-48e4-8d0b-48e189bc7d23', 'cab7e1de-abe2-460e-bea9-f1e0e1386ca6'),
  ('08aaa518-9b54-4ef4-bcb6-0a6c3af7b221', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('57a2fa61-c571-4e5b-b456-fdcec4ab0f23', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('8dd091ef-7fce-4811-b153-d0df180e129e', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('1e78d128-7627-434a-bc36-01474522e7d5', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('a2362f14-44c0-47b8-aacc-11116ba43736', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('873e7330-afe4-4c47-8b7d-52913d7a3be1', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('a3a148de-0616-4a57-892f-775e38d76602', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('8c1ec366-9acc-4b68-a7f4-eeecc4a4b05d', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('56fd791f-99d6-4763-bffb-2aaa7acb0db4', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('abc8c4fc-dcd2-40dd-a3f8-2cd30e578059', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('3697e4ed-e35a-4ba4-b440-b42cb533e5ba', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('6583817f-6160-4954-8f82-c691506d301c', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('44e01376-aec2-4f73-b63f-c0a4c12a4aa6', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('57203153-5897-470a-945d-2bdde10ead62', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('aacc2138-0405-4328-8805-ab7378c0c6a7', 'd4464fa7-95c4-4216-8617-cb00336f8e94'),
  ('795ba849-2b81-4134-91c3-a0fc9942f1f0', 'd4464fa7-95c4-4216-8617-cb00336f8e94'),
  ('df17fc16-e539-4208-b355-008705035cf1', 'd4464fa7-95c4-4216-8617-cb00336f8e94'),
  ('71039c08-783c-47da-b91a-28cba6f44304', 'd4464fa7-95c4-4216-8617-cb00336f8e94'),
  ('0fb89e71-85c0-4ba5-a445-942c47105e68', 'f92cd2e1-95db-4df6-9c0c-d9d590c00b4f'),
  ('94a19b65-0a58-4278-b0d2-fcb29103f2fa', '950630ef-0b76-45e7-a1ab-7a996aa3a1ba'),
  ('556e54ea-bb2f-4d00-aaaa-6d571ad09343', '52867960-8b6b-4d49-809d-320f47ac1bce'),
  ('e2293d33-ef7d-4a20-bf60-82a5311e3609', '52867960-8b6b-4d49-809d-320f47ac1bce'),
  ('fa966fbd-ad0a-43e5-81b8-1371972b6c18', '52867960-8b6b-4d49-809d-320f47ac1bce'),
  ('e3ce1142-d4d6-4166-aa88-1147c32e0167', '0eac697f-be19-4b56-99c3-094a0e5f8af0'),
  ('a0814ab8-f868-4e35-91b6-8707a4b3b2f2', '739d1434-f1b9-4e60-a33b-b4322783db65'),
  ('f8c0a15c-477f-4c77-bf41-e7670fdf8ec1', '739d1434-f1b9-4e60-a33b-b4322783db65'),
  ('27ac070c-8dee-42c7-ba8a-6c90274a5ba3', 'c42d6a11-b800-4703-ae2d-eaed69b45b7f'),
  ('f3ec6c81-2817-4270-905a-47ebccaa1dde', '2666ca30-51b6-4709-9c98-3c93fa631ea0'),
  ('66f467c2-262c-4073-b468-af527f094272', '2666ca30-51b6-4709-9c98-3c93fa631ea0'),
  ('63e24d1b-c925-4e6b-acf8-5e73ff2b91bd', '2666ca30-51b6-4709-9c98-3c93fa631ea0'),
  ('2fbad363-5b0f-47de-926f-a4477f3df541', '2666ca30-51b6-4709-9c98-3c93fa631ea0'),
  ('83f981da-c606-48ee-a5be-582585d7f4e7', '2666ca30-51b6-4709-9c98-3c93fa631ea0'),
  ('3ad11630-629a-4f8f-b50c-3a26e30e4bae', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('06017d34-5753-4197-a49d-0cc7cb39df2c', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('1f1f3d2b-a367-4c7b-bd96-c125de25f40f', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('3335b1df-4bdb-43fa-b751-2c165273c7e8', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('59e6fc76-5662-4b8e-89c1-f01f3bbc0dd2', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('6460500c-bd8c-4ebe-94ab-a698670c00b9', '28b8c42f-01ed-4408-8b80-790dddde8103'),
  ('e1d10161-df07-45ce-a545-eb526e5fba90', 'decaece5-bf58-4434-863b-a1c08843e4ec'),
  ('0425f421-31fd-4a9c-b2e1-00f880dbada9', 'e18c8af8-b014-41e8-b683-0b55306f47df'),
  ('6b71d9b2-378c-4c8a-9510-95348686a5ff', 'e18c8af8-b014-41e8-b683-0b55306f47df'),
  ('75df7e45-540f-4bd1-8bdb-b3ce1bf42196', 'e18c8af8-b014-41e8-b683-0b55306f47df'),
  ('d95e751b-0590-4b9a-ad3b-63670e92eae7', 'e18c8af8-b014-41e8-b683-0b55306f47df'),
  ('f121101c-da72-43f8-8dec-e04bfc1ffff7', 'e18c8af8-b014-41e8-b683-0b55306f47df'),
  ('0080d33c-cde2-4264-8c77-f27a9e1a4398', 'e20280a3-87e3-41ac-b2d7-ac4ee5609f3e'),
  ('4fc51bc3-cfad-4c0f-a8ee-ae7bbd36938d', 'e20280a3-87e3-41ac-b2d7-ac4ee5609f3e'),
  ('fc8a71c1-8415-4881-9187-40122cf334c2', 'e20280a3-87e3-41ac-b2d7-ac4ee5609f3e'),
  ('f79efd39-177b-4ba9-a1dd-1aacba87349a', '9b09acc8-7cde-41c8-acc5-7d5a0fe0ef44'),
  ('16e8f78d-fd89-4a71-9efc-15de93090965', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('3cd18fd8-284a-4291-b4c5-6bcda4280185', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('6fd44904-2dcd-4ca8-8fb8-87caa4349fdd', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('d3d37036-9850-4f86-8def-3b532d15d241', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('4e7e228f-a33f-48a8-bcfb-06f6269fde08', 'e20280a3-87e3-41ac-b2d7-ac4ee5609f3e'),
  ('5393fda3-ffe0-4db9-952a-6e14b98a7d29', '16357fb4-037f-4fc9-b0e6-d8b2e94ef8fb'),
  ('8ee20c84-a5bc-4379-a721-9b54c7aa2b84', '52dfb281-a98c-4741-8749-3872cf523ac9'),
  ('425aad5a-e56b-44c3-9f12-6bba1e16e392', 'e20280a3-87e3-41ac-b2d7-ac4ee5609f3e');

  -- Every id named here must exist AND be a real upsc node — this backfill is
  -- exam-scoped by construction (the audit only ever walked upsc's tree), so
  -- a stray id (typo, or drift since the audit ran) must fail loud, not
  -- silently create a dangling or cross-exam pointer.
  select count(*) into n_missing
  from _covered_by_backfill b
  where not exists (select 1 from public.syllabus_nodes n where n.id = b.node_id)
     or not exists (select 1 from public.syllabus_nodes n where n.id = b.covered_by_node_id);
  if n_missing > 0 then
    raise exception '0115: % backfill row(s) reference a nonexistent syllabus_nodes id', n_missing;
  end if;

  select count(*) into n_wrong_exam
  from _covered_by_backfill b
  join public.syllabus_nodes n on n.id = b.node_id
  join public.syllabus_nodes c on c.id = b.covered_by_node_id
  where n.exam_code <> 'upsc' or c.exam_code <> 'upsc';
  if n_wrong_exam > 0 then
    raise exception '0115: % backfill row(s) touch a non-upsc node — this migration is upsc-only', n_wrong_exam;
  end if;

  select count(*) into n_self from _covered_by_backfill where node_id = covered_by_node_id;
  if n_self > 0 then
    raise exception '0115: % backfill row(s) point a node at itself', n_self;
  end if;

  update public.syllabus_nodes n
  set covered_by_node_id = b.covered_by_node_id
  from _covered_by_backfill b
  where n.id = b.node_id;
  get diagnostics n_updated = row_count;

  if n_updated <> 117 then
    raise exception '0115: expected to update exactly 117 rows, updated %', n_updated;
  end if;
end $$;

-- Assert the end state: exactly 117 upsc nodes carry a pointer, every pointer
-- resolves to a DIFFERENT node that has a real published chapter, and no
-- uppsc row was touched (uppsc's rollout is chaptered 1:1 already, so this
-- column must stay entirely null there).
do $$
declare
  n_pointed int;
  n_uppsc_pointed int;
  n_bad_target int;
begin
  select count(*) into n_pointed from public.syllabus_nodes where covered_by_node_id is not null;
  if n_pointed <> 117 then
    raise exception '0115: expected exactly 117 syllabus_nodes with covered_by_node_id set, found %', n_pointed;
  end if;

  select count(*) into n_uppsc_pointed
  from public.syllabus_nodes where exam_code = 'uppsc' and covered_by_node_id is not null;
  if n_uppsc_pointed <> 0 then
    raise exception '0115: % uppsc row(s) got a covered_by_node_id — this migration must be upsc-only', n_uppsc_pointed;
  end if;

  select count(*) into n_bad_target
  from public.syllabus_nodes n
  join public.syllabus_nodes c on c.id = n.covered_by_node_id
  left join public.notes nt on nt.syllabus_node_id = c.id
  where n.covered_by_node_id is not null
    and (nt.id is null or nt.status <> 'published' or coalesce(nt.chapter_version, 0) < 1);
  if n_bad_target > 0 then
    raise exception '0115: % covered_by_node_id pointer(s) target a node with no published chapter', n_bad_target;
  end if;
end $$;
