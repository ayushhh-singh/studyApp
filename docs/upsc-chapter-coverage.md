# Study-chapter coverage — `upsc`

> **Generated file — do not hand-edit.** Regenerate with:
>
> ```
> pnpm notes:coverage --exam upsc --out docs/upsc-chapter-coverage.md
> ```
>
> Read live from the database on **2026-08-22** (IST). Every query is paged (`selectAll`) — PostgREST truncates a bare select at 1000 rows and this report would silently UNDER-report coverage rather than fail.

**78 of 195 chapterable nodes have a published chapter (40%).** The exam has **202** syllabus nodes in total; the **7** depth-0 paper roots are excluded from every denominator here because a chapter is authored per topic, not per paper (`notes/generate.ts::topWeightageNodes` filters `depth >= 1`, and `uppsc`'s complete rollout is 284 chapters over 294 nodes — exactly its 10 roots short).

"Covered" means a **published** chapter: a `notes` row whose `study_content_i18n.sections` is non-empty AND whose `status` is `published`. A legacy digest-only note, a draft, or a chapter still holding unresolved fact-audit flags is **not** coverage and is listed as such.

## Per paper

| Paper | Chaptered | Nodes | % | Remaining | PYQ weight |
| --- | ---: | ---: | ---: | ---: | ---: |
| `UPSC_PRE_GS1` | 24 | 32 | 75% | 8 | 1846 |
| `UPSC_PRE_CSAT` | 9 | 12 | 75% | 3 | 1407 |
| `UPSC_MAINS_GS2` | 9 | 30 | 30% | 21 | 398 |
| `UPSC_MAINS_GS3` | 9 | 38 | 23.7% | 29 | 394 |
| `UPSC_MAINS_GS1` | 12 | 44 | 27.3% | 32 | 384 |
| `UPSC_MAINS_GS4` | 10 | 34 | 29.4% | 24 | 260 |
| `UPSC_MAINS_ESSAY` | 5 | 5 | 100% | 0 | 80 |
| **all** | **78** | **195** | **40%** | **117** | 4769 |

## Every node, heaviest first

This ordering **is the worklist**: the next node to author is the topmost row whose Chapter column reads `— none`. Dump its pack with `pnpm notes:chapter:context --node <node_id> --dir <dir>`. Weightage is the subtree roll-up (own + descendants) from `mv_node_weightage`, the same number `topWeightageNodes` ranks by — so a depth-1 section and its own depth-2 children both appear, and both are legitimately chaptered (that is how `uppsc` is covered).

| # | Weight | Paper | D | Node | Chapter | node_id |
| ---: | ---: | --- | ---: | --- | --- | --- |
| 1 | 292 | `UPSC_PRE_CSAT` | 1 | Basic Numeracy and Data Interpretation | published · chapter v3 | `c42d6a11-b800-4703-ae2d-eaed69b45b7f` |
| 2 | 269 | `UPSC_PRE_CSAT` | 2 | Basic Numeracy | published · chapter v1 | `f902af4d-8db5-4fa4-af60-8aacdb0b8efd` |
| 3 | 258 | `UPSC_PRE_CSAT` | 1 | Logical Reasoning and Analytical Ability | published · chapter v1 | `bac0e217-1cfe-4f8d-8c7e-1db4e3f570c6` |
| 4 | 246 | `UPSC_PRE_CSAT` | 1 | Comprehension | published · chapter v1 | `e61f39da-fcbb-4672-a9fd-ede60695a730` |
| 5 | 203 | `UPSC_PRE_GS1` | 1 | Indian Polity and Governance | published · chapter v1 | `8fd021cb-5d14-42b1-b6fa-36a071fd49d6` |
| 6 | 185 | `UPSC_PRE_GS1` | 1 | Economic and Social Development | published · chapter v3 | `16357fb4-037f-4fc9-b0e6-d8b2e94ef8fb` |
| 7 | 175 | `UPSC_PRE_GS1` | 1 | History of India and Indian National Movement | published · chapter v2 | `fc3c0ede-399f-4153-9036-48d2b557ce42` |
| 8 | 154 | `UPSC_PRE_CSAT` | 2 | Logical Reasoning | published · chapter v1 | `33fb1f9c-b3c1-489f-9c69-c3bcda923b56` |
| 9 | 144 | `UPSC_PRE_GS1` | 1 | General Science | published · chapter v1 | `699d0aad-59ed-4beb-9c36-e66ae244a2f5` |
| 10 | 132 | `UPSC_PRE_GS1` | 1 | Environmental Ecology, Bio-diversity and Climate Change | published · chapter v1 | `9387bf60-969e-4992-8e76-ebdb2e5d2cde` |
| 11 | 116 | `UPSC_PRE_GS1` | 1 | Current Events of National and International Importance | published · chapter v1 | `650d3c8d-37e8-4be0-a240-0f297fb52a1a` |
| 12 | 102 | `UPSC_PRE_GS1` | 1 | Indian and World Geography | published · chapter v4 | `52dfb281-a98c-4741-8749-3872cf523ac9` |
| 13 | 90 | `UPSC_PRE_CSAT` | 2 | Analytical Ability | published · chapter v1 | `a5296db4-7445-4edb-9b27-bf9029706fb3` |
| 14 | 78 | `UPSC_PRE_GS1` | 2 | Constitution of India | published · chapter v1 | `7b761a98-aaae-4aaa-9b12-2f7e88de6a6b` |
| 15 | 71 | `UPSC_MAINS_GS2` | 1 | Indian Polity | published · chapter v2 | `28b8c42f-01ed-4408-8b80-790dddde8103` |
| 16 | 68 | `UPSC_PRE_GS1` | 2 | Ancient India | published · chapter v1 | `a7a37c7e-dde7-4f99-a7be-5634cb432e69` |
| 17 | 65 | `UPSC_MAINS_GS1` | 1 | Indian Society | published · chapter v3 | `65e153a6-0b25-4904-94ba-9f2277795e02` |
| 18 | 64 | `UPSC_PRE_GS1` | 2 | Biology | published · chapter v1 | `bb36c84f-75d7-499d-818a-4fca2a85f9e8` |
| 19 | 54 | `UPSC_PRE_GS1` | 2 | Public Policy | published · chapter v3 | `decaece5-bf58-4434-863b-a1c08843e4ec` |
| 20 | 50 | `UPSC_MAINS_ESSAY` | 1 | Essays on Multiple Topics | published · chapter v1 | `0cf7f2bb-6583-4e99-a92a-5d2881816712` |
| 21 | 46 | `UPSC_PRE_GS1` | 2 | Bio-diversity | published · chapter v1 | `d2c80e73-41a1-4f3b-8b18-8a5675a0cdc9` |
| 22 | 45 | `UPSC_PRE_GS1` | 2 | Political System | published · chapter v2 | `3c726bd5-677c-492d-bb8d-912d05f4c383` |
| 23 | 42 | `UPSC_MAINS_GS4` | 1 | Case Studies and Problem-Solving Approach | published · chapter v1 | `0eac697f-be19-4b56-99c3-094a0e5f8af0` |
| 24 | 40 | `UPSC_MAINS_GS2` | 1 | International Relations | published · chapter v2 | `2666ca30-51b6-4709-9c98-3c93fa631ea0` |
| 25 | 40 | `UPSC_PRE_GS1` | 2 | Geography of India | published · chapter v1 | `b8728072-5de6-405a-91b3-8fd6c7460c47` |
| 26 | 39 | `UPSC_MAINS_GS3` | 1 | Internal Security | published · chapter v2 | `0b4b24f5-134b-4532-9b42-9fe2daef321d` |
| 27 | 39 | `UPSC_PRE_GS1` | 2 | Climate Change | published · chapter v1 | `1803cd3f-cf00-4ae7-8127-4162a5c33aae` |
| 28 | 39 | `UPSC_PRE_GS1` | 2 | Modern India | published · chapter v1 | `ec19feac-5476-4c1d-bd3d-81a03e704870` |
| 29 | 38 | `UPSC_MAINS_GS3` | 1 | Agriculture, Food Security and Land Reforms | published · chapter v2 | `2bf48454-967e-4059-9016-9b4d72eacc92` |
| 30 | 37 | `UPSC_PRE_GS1` | 2 | Sustainable Development | published · chapter v1 | `034280e8-47a8-44e4-98bc-455060a2b3b5` |
| 31 | 33 | `UPSC_MAINS_GS3` | 1 | Indian Economy, Planning and Investment | published · chapter v3 | `cab7e1de-abe2-460e-bea9-f1e0e1386ca6` |
| 32 | 33 | `UPSC_PRE_GS1` | 2 | Environmental Ecology | published · chapter v2 | `6531ab4b-3707-4dff-af27-4dbe6f2880d6` |
| 33 | 33 | `UPSC_PRE_GS1` | 2 | Indian National Movement | published · chapter v2 | `449d1034-2fe7-4a1f-9a0e-6dd8db47e686` |
| 34 | 32 | `UPSC_MAINS_GS2` | 1 | Governance | published · chapter v2 | `e18c8af8-b014-41e8-b683-0b55306f47df` |
| 35 | 32 | `UPSC_MAINS_GS2` | 1 | Social Justice | published · chapter v3 | `e20280a3-87e3-41ac-b2d7-ac4ee5609f3e` |
| 36 | 32 | `UPSC_PRE_GS1` | 2 | Medieval India | published · chapter v1 | `b1ebdbcd-71fe-4e53-a5a6-f6729f9cf7d0` |
| 37 | 32 | `UPSC_PRE_GS1` | 2 | Social Sector Initiatives | published · chapter v1 | `31297df0-0d55-4365-b6d3-ff459c15fc03` |
| 38 | 31 | `UPSC_MAINS_GS4` | 2 | Attitude, Integrity and Problem-Solving Approach in Public Life | published · chapter v1 | `f92cd2e1-95db-4df6-9c0c-d9d590c00b4f` |
| 39 | 30 | `UPSC_PRE_CSAT` | 1 | Decision Making and Problem Solving | published · chapter v2 | `739d1434-f1b9-4e60-a33b-b4322783db65` |
| 40 | 29 | `UPSC_PRE_GS1` | 2 | Physics | published · chapter v1 | `55c52be0-c5fd-4353-901e-3ec9eacba746` |
| 41 | 28 | `UPSC_MAINS_GS3` | 1 | Science and Technology | published · chapter v2 | `788bfc11-18a6-45da-8e4b-a2892898839a` |
| 42 | 27 | `UPSC_PRE_GS1` | 2 | Physical Geography | — none | `3cd18fd8-284a-4291-b4c5-6bcda4280185` |
| 43 | 26 | `UPSC_MAINS_ESSAY` | 1 | Effective and Exact Expression | published · chapter v1 | `56d73d96-1f36-41a5-b683-d2c4e4825d5e` |
| 44 | 26 | `UPSC_MAINS_GS1` | 1 | Natural Resources and Industrial Location | published · chapter v1 | `138d1bb8-e76d-4778-baf1-0f49e7baf2a0` |
| 45 | 26 | `UPSC_MAINS_GS3` | 1 | Bio diversity, Environment and Conservation | published · chapter v1 | `4711c7dd-fc2c-4806-8e1e-d03176a5ed75` |
| 46 | 25 | `UPSC_MAINS_GS4` | 1 | Public/Civil Service Values and Ethics in Public Administration | — none | `0fb89e71-85c0-4ba5-a445-942c47105e68` |
| 47 | 24 | `UPSC_MAINS_GS2` | 1 | Indian Constitution | published · chapter v1 | `9b09acc8-7cde-41c8-acc5-7d5a0fe0ef44` |
| 48 | 23 | `UPSC_PRE_CSAT` | 2 | Data Interpretation | — none | `27ac070c-8dee-42c7-ba8a-6c90274a5ba3` |
| 49 | 23 | `UPSC_PRE_GS1` | 2 | World Geography | — none | `d3d37036-9850-4f86-8def-3b532d15d241` |
| 50 | 22 | `UPSC_MAINS_GS1` | 1 | Geophysical Phenomena and Geographical Features | published · chapter v1 | `741d1f11-8743-4fc8-bd70-b86c768b0a3d` |
| 51 | 22 | `UPSC_MAINS_GS4` | 1 | Probity in Governance | published · chapter v1 | `52867960-8b6b-4d49-809d-320f47ac1bce` |
| 52 | 22 | `UPSC_PRE_CSAT` | 2 | Problem Solving | — none | `f8c0a15c-477f-4c77-bf41-e7670fdf8ec1` |
| 53 | 20 | `UPSC_MAINS_GS1` | 1 | Indian Heritage and Culture | published · chapter v2 | `c96118de-c365-4002-9301-d8cf3555f4ce` |
| 54 | 20 | `UPSC_MAINS_GS3` | 1 | Industry, Food Processing and Infrastructure | published · chapter v1 | `a0d6f7fb-39ca-434e-922f-209f487324fb` |
| 55 | 20 | `UPSC_PRE_GS1` | 2 | Chemistry | published · chapter v1 | `210eca09-b59f-45fe-bc0d-e1972eb078f5` |
| 56 | 20 | `UPSC_PRE_GS1` | 2 | Rights Issues | — none | `425aad5a-e56b-44c3-9f12-6bba1e16e392` |
| 57 | 19 | `UPSC_MAINS_GS1` | 1 | Salient Features of World’s Physical Geography | published · chapter v1 | `2ac8068e-1c06-4f6e-9932-f53be93bd914` |
| 58 | 17 | `UPSC_MAINS_GS1` | 2 | Salient Features of Indian Society and Diversity of India | — none | `6ca8fe50-1e7b-4559-895f-2c6eaa2cf7f7` |
| 59 | 15 | `UPSC_MAINS_GS1` | 1 | Modern Indian History | published · chapter v1 | `2e9e4c46-6165-402b-ba92-74b6ee8bfdc8` |
| 60 | 15 | `UPSC_MAINS_GS2` | 2 | Significant Provisions, Amendments and Basic Structure | published · chapter v1 | `a4795faa-91be-45c7-8e85-e2e4bcddcfb3` |
| 61 | 15 | `UPSC_MAINS_GS3` | 2 | Environmental Pollution and Degradation | — none | `5b340e2f-23f3-4f10-b13e-1f3282045de8` |
| 62 | 14 | `UPSC_MAINS_GS3` | 1 | Disaster and Disaster Management | published · chapter v1 | `a7331b44-0756-46f0-82ee-c6bcf3f0eb40` |
| 63 | 14 | `UPSC_MAINS_GS4` | 1 | Ethics and Human Interface | published · chapter v1 | `d4464fa7-95c4-4216-8617-cb00336f8e94` |
| 64 | 13 | `UPSC_MAINS_GS2` | 2 | Social Sector/Services — Health, Education and Human Resources | — none | `4fc51bc3-cfad-4c0f-a8ee-ae7bbd36938d` |
| 65 | 13 | `UPSC_MAINS_GS2` | 2 | Statutory, Regulatory and Quasi-Judicial Bodies | — none | `e1d10161-df07-45ce-a545-eb526e5fba90` |
| 66 | 13 | `UPSC_MAINS_GS3` | 2 | Border Area Security and Linkages of Organized Crime with Terrorism | — none | `a8059332-59e6-4cbe-926a-ba279a36c556` |
| 67 | 12 | `UPSC_MAINS_GS3` | 2 | Inclusive Growth and Issues Arising from It | — none | `82c02f3d-6af8-4dd4-ac4f-9c28459bf6ad` |
| 68 | 12 | `UPSC_MAINS_GS4` | 1 | Contributions of Moral Thinkers and Philosophers | — none | `6583817f-6160-4954-8f82-c691506d301c` |
| 69 | 12 | `UPSC_MAINS_GS4` | 2 | Ethical Concerns and Dilemmas in Government and Private Institutions | published · chapter v1 | `ae69e0b1-cb8d-49c5-86de-4fecf37e9ba5` |
| 70 | 11 | `UPSC_MAINS_GS1` | 2 | Resources of South Asia and the Indian Sub-continent | published · chapter v2 | `0f2c8cbb-9420-4740-a764-0ce40b333f0c` |
| 71 | 11 | `UPSC_MAINS_GS1` | 1 | The Freedom Struggle | published · chapter v1 | `547b0b28-58fa-483f-a461-7bec7ab96cec` |
| 72 | 11 | `UPSC_MAINS_GS2` | 2 | Bilateral, Regional and Global Groupings and Agreements | — none | `66f467c2-262c-4073-b468-af527f094272` |
| 73 | 11 | `UPSC_MAINS_GS2` | 2 | Parliament and State Legislatures | published · chapter v1 | `797f2822-827f-433e-bf98-d8bd297f1260` |
| 74 | 11 | `UPSC_MAINS_GS2` | 2 | Welfare Schemes and Protection Mechanisms for Vulnerable Sections | — none | `fc8a71c1-8415-4881-9187-40122cf334c2` |
| 75 | 11 | `UPSC_MAINS_GS3` | 2 | Developments in Science and Technology and Everyday Applications | — none | `7b86a05d-74d1-4dae-9d76-506003b17448` |
| 76 | 11 | `UPSC_MAINS_GS3` | 2 | Infrastructure: Energy, Ports, Roads, Airports, Railways | — none | `887865b0-3437-4ba0-8b4d-1ff8dee8464b` |
| 77 | 11 | `UPSC_MAINS_GS3` | 2 | Major Crops and Cropping Patterns in Various Parts of the Country | — none | `2a514471-9973-4c0c-9279-affecd618234` |
| 78 | 11 | `UPSC_MAINS_GS4` | 2 | Case Studies on the Above Issues | — none | `e3ce1142-d4d6-4166-aa88-1147c32e0167` |
| 79 | 11 | `UPSC_PRE_CSAT` | 1 | General Mental Ability | published · chapter v2 | `01763fc9-5cbd-4ced-8bb9-01a6ebdd9380` |
| 80 | 11 | `UPSC_PRE_GS1` | 2 | Economic Geography | — none | `6fd44904-2dcd-4ca8-8fb8-87caa4349fdd` |
| 81 | 10 | `UPSC_MAINS_GS1` | 2 | Distribution of Key Natural Resources Across the World | — none | `6a724f93-560d-491e-a1ed-4c5e025ab978` |
| 82 | 10 | `UPSC_MAINS_GS1` | 2 | Earthquakes, Tsunami, Volcanic Activity and Cyclones | published · chapter v1 | `d5acab53-a65b-4d6d-98ef-6ad35171023f` |
| 83 | 10 | `UPSC_MAINS_GS1` | 2 | Effects of Globalization on Indian Society | — none | `e02d96c1-2586-4360-8c47-504e87ed1a00` |
| 84 | 10 | `UPSC_MAINS_GS1` | 2 | Urbanization, its Problems and their Remedies | — none | `2e6380c8-2572-4e50-8c75-8233e55244bb` |
| 85 | 10 | `UPSC_MAINS_GS2` | 2 | Devolution of Powers and Finances up to Local Levels | — none | `06017d34-5753-4197-a49d-0cc7cb39df2c` |
| 86 | 10 | `UPSC_MAINS_GS2` | 2 | India and its Neighborhood — Relations | — none | `f3ec6c81-2817-4270-905a-47ebccaa1dde` |
| 87 | 10 | `UPSC_MAINS_GS2` | 2 | Structure and Functioning of the Executive and the Judiciary | — none | `59e6fc76-5662-4b8e-89c1-f01f3bbc0dd2` |
| 88 | 10 | `UPSC_MAINS_GS3` | 2 | Irrigation Systems, Storage, Transport and Marketing of Produce | — none | `257489cf-7b13-4c0b-9484-f9025ddbd039` |
| 89 | 9 | `UPSC_MAINS_GS1` | 2 | Communalism, Regionalism & Secularism | — none | `bb69ebe0-9462-4956-89cd-ac36647c9df0` |
| 90 | 9 | `UPSC_MAINS_GS2` | 2 | E-Governance and Citizens Charters | — none | `0425f421-31fd-4a9c-b2e1-00f880dbada9` |
| 91 | 9 | `UPSC_MAINS_GS2` | 2 | Important Aspects of Governance, Transparency and Accountability | — none | `75df7e45-540f-4bd1-8bdb-b3ce1bf42196` |
| 92 | 9 | `UPSC_MAINS_GS2` | 2 | Important International Institutions, Agencies and Fora | — none | `63e24d1b-c925-4e6b-acf8-5e73ff2b91bd` |
| 93 | 9 | `UPSC_MAINS_GS3` | 2 | Basics of Cyber Security and Money-Laundering Prevention | — none | `cdf456e6-8c76-4444-8536-712b964ce048` |
| 94 | 9 | `UPSC_MAINS_GS3` | 2 | Disaster Management: Mitigation, Preparedness and Response | — none | `e3f1d01c-c154-45ef-be4f-5ee22e54192a` |
| 95 | 9 | `UPSC_MAINS_GS3` | 2 | Growth, Development and Employment | — none | `c44de8cc-2308-4e78-9e4b-4a82f0b07827` |
| 96 | 9 | `UPSC_MAINS_GS4` | 2 | Moral Thinkers and Philosophers from India | — none | `57203153-5897-470a-945d-2bdde10ead62` |
| 97 | 8 | `UPSC_MAINS_GS1` | 2 | Climate and Atmospheric Processes | — none | `e659dfbd-6d75-4b32-b74f-78625132fda2` |
| 98 | 8 | `UPSC_MAINS_GS1` | 1 | History of the World | published · chapter v3 | `3e0a87a1-5121-4a5f-9a0a-0094d0c9e0c6` |
| 99 | 8 | `UPSC_MAINS_GS1` | 2 | Population, Poverty and Developmental Issues | — none | `e63b0a55-ea7e-4958-936f-5315c9972da1` |
| 100 | 8 | `UPSC_MAINS_GS1` | 2 | Salient Aspects of Indian Art Forms | — none | `1f2d51cf-2965-4a76-8297-a66e58e78b1b` |
| 101 | 8 | `UPSC_MAINS_GS2` | 2 | Issues Relating to Poverty and Hunger | — none | `0080d33c-cde2-4264-8c77-f27a9e1a4398` |
| 102 | 8 | `UPSC_MAINS_GS3` | 2 | Bio-technology and Intellectual Property Rights | — none | `9f73f5dc-6a75-458e-9507-07078fcd13bf` |
| 103 | 8 | `UPSC_MAINS_GS3` | 2 | Conservation | — none | `8aa21e0d-066e-4fcd-a297-5dc2f7d91b69` |
| 104 | 8 | `UPSC_MAINS_GS3` | 2 | Linkages Between Development and Spread of Extremism | — none | `4e30968a-1a31-41af-95fd-9e4d1055a9df` |
| 105 | 8 | `UPSC_MAINS_GS4` | 1 | Aptitude and Foundational Values for Civil Service | — none | `a2362f14-44c0-47b8-aacc-11116ba43736` |
| 106 | 8 | `UPSC_PRE_CSAT` | 2 | Decision Making | — none | `a0814ab8-f868-4e35-91b6-8707a4b3b2f2` |
| 107 | 7 | `UPSC_MAINS_GS1` | 2 | Gandhian Mass Movements | — none | `75719fe0-e0e6-427a-8228-3e9b54c577ae` |
| 108 | 7 | `UPSC_MAINS_GS1` | 1 | Post-Independence Consolidation and Reorganization | published · chapter v1 | `d2b95a3c-c548-441b-9d1e-e3d9da73fe48` |
| 109 | 7 | `UPSC_MAINS_GS1` | 2 | Role of Women and Women’s Organization | — none | `86bcd476-d289-45a4-9054-a042678d50fb` |
| 110 | 7 | `UPSC_MAINS_GS2` | 2 | Effect of Policies and Politics of Developed and Developing Countries | — none | `2fbad363-5b0f-47de-926f-a4477f3df541` |
| 111 | 7 | `UPSC_MAINS_GS2` | 2 | Pressure Groups and Formal/Informal Associations | — none | `1f1f3d2b-a367-4c7b-bd96-c125de25f40f` |
| 112 | 7 | `UPSC_MAINS_GS2` | 2 | Salient Features of the Representation of People’s Act | — none | `6460500c-bd8c-4ebe-94ab-a698670c00b9` |
| 113 | 7 | `UPSC_MAINS_GS3` | 2 | Awareness in IT, Space, Computers, Robotics and Nano-technology | published · chapter v1 | `2705ca94-c869-4577-be39-aa5b38bfa460` |
| 114 | 7 | `UPSC_MAINS_GS3` | 2 | Government Budgeting | — none | `3770b332-1541-49c7-a92b-0eb39fa45ebf` |
| 115 | 6 | `UPSC_MAINS_GS1` | 2 | Changes in Flora and Fauna and their Effects | published · chapter v1 | `a0dd11c5-7707-4255-9e94-ad3193212ef6` |
| 116 | 6 | `UPSC_MAINS_GS1` | 2 | Expansion and Consolidation of British Rule | — none | `b0fbf2d5-ef93-4e7c-bc62-10f594348bd3` |
| 117 | 6 | `UPSC_MAINS_GS1` | 2 | Landforms and Geomorphology | — none | `09ffe9b5-6776-4beb-a11c-80969d318cc6` |
| 118 | 6 | `UPSC_MAINS_GS1` | 2 | Salient Aspects of Indian literature | — none | `4df27ee5-b7b8-4f76-9837-a1a88213aa38` |
| 119 | 6 | `UPSC_MAINS_GS2` | 2 | Comparison with the Constitutional Schemes of Other Countries | — none | `f79efd39-177b-4ba9-a1dd-1aacba87349a` |
| 120 | 6 | `UPSC_MAINS_GS2` | 2 | Functions and Responsibilities of the Union and the States | — none | `3ad11630-629a-4f8f-b50c-3a26e30e4bae` |
| 121 | 6 | `UPSC_MAINS_GS4` | 2 | Challenges of Corruption | published · chapter v1 | `c38491fa-4e11-443c-af8c-a8b0f975b73e` |
| 122 | 6 | `UPSC_MAINS_GS4` | 2 | Essence, Determinants and Consequences of Ethics in Human Actions | — none | `aacc2138-0405-4328-8805-ab7378c0c6a7` |
| 123 | 5 | `UPSC_MAINS_GS1` | 2 | Location Factors for Primary, Secondary and Tertiary Industries | — none | `6c7ae638-3216-4635-9cef-7a00d6e4ab41` |
| 124 | 5 | `UPSC_MAINS_GS1` | 2 | Oceans and Ocean Currents | — none | `a497600f-0a70-41dd-81db-54656b07d967` |
| 125 | 5 | `UPSC_MAINS_GS1` | 2 | Salient Aspects of Indian Architecture | — none | `c4a10c6a-ba82-4977-8940-63fd21461e57` |
| 126 | 5 | `UPSC_MAINS_GS1` | 2 | Socio-Religious Reform Movements | — none | `dd76a317-a35d-4fba-b339-e7edcde85789` |
| 127 | 5 | `UPSC_MAINS_GS2` | 2 | Development Processes and the Development Industry | — none | `6b71d9b2-378c-4c8a-9510-95348686a5ff` |
| 128 | 5 | `UPSC_MAINS_GS2` | 2 | Government Policies and Interventions for Development | — none | `f121101c-da72-43f8-8dec-e04bfc1ffff7` |
| 129 | 5 | `UPSC_MAINS_GS2` | 2 | Separation of Powers and Dispute Redressal Mechanisms | — none | `3335b1df-4bdb-43fa-b751-2c165273c7e8` |
| 130 | 5 | `UPSC_MAINS_GS3` | 2 | Disasters: Types, Vulnerability and Risk | — none | `83812b51-f09c-4050-b043-2890664c62dd` |
| 131 | 5 | `UPSC_MAINS_GS3` | 2 | Food Processing and Related Industries in India | — none | `2d31cd07-4d43-4145-a356-f102305021f0` |
| 132 | 5 | `UPSC_MAINS_GS3` | 2 | Public Distribution System, Buffer Stocks and Food Security | — none | `d2d937fd-b482-4a82-8f82-e3c8b340bc1a` |
| 133 | 5 | `UPSC_MAINS_GS3` | 2 | Role of External State and Non-State Actors | — none | `306a4bcb-66bb-4018-9a48-cb25714da4cd` |
| 134 | 5 | `UPSC_MAINS_GS4` | 1 | Emotional Intelligence | — none | `56fd791f-99d6-4763-bffb-2aaa7acb0db4` |
| 135 | 5 | `UPSC_MAINS_GS4` | 2 | Ethical Issues in International Relations and Corporate Governance | published · chapter v1 | `5ea4f1e7-4afd-4163-86ec-d2dfe9033de9` |
| 136 | 5 | `UPSC_PRE_GS1` | 2 | Inclusion | — none | `5393fda3-ffe0-4db9-952a-6e14b98a7d29` |
| 137 | 5 | `UPSC_PRE_GS1` | 2 | Poverty | — none | `4e7e228f-a33f-48a8-bcfb-06f6269fde08` |
| 138 | 4 | `UPSC_MAINS_GS1` | 2 | Social Empowerment | — none | `3993e690-4da4-4264-aeb3-9912cd7afa81` |
| 139 | 4 | `UPSC_MAINS_GS2` | 2 | Role of Civil Services in a Democracy | — none | `d95e751b-0590-4b9a-ad3b-63670e92eae7` |
| 140 | 4 | `UPSC_MAINS_GS3` | 2 | Direct and Indirect Farm Subsidies and Minimum Support Prices | — none | `af550896-5187-4398-a9b6-5a729b1bbf15` |
| 141 | 4 | `UPSC_MAINS_GS3` | 2 | Effects of Liberalization and Changes in Industrial Policy | — none | `57fa8604-7265-4c8e-bda0-bd3f1552fba0` |
| 142 | 4 | `UPSC_MAINS_GS3` | 2 | Land Reforms in India | — none | `48e7275f-08ba-40f6-ba6d-efae3b452eb1` |
| 143 | 4 | `UPSC_MAINS_GS4` | 2 | Concept of Public Service and Philosophical Basis of Probity | — none | `556e54ea-bb2f-4d00-aaaa-6d571ad09343` |
| 144 | 4 | `UPSC_MAINS_GS4` | 2 | Emotional Intelligence: Concepts and Utilities | — none | `abc8c4fc-dcd2-40dd-a3f8-2cd30e578059` |
| 145 | 4 | `UPSC_MAINS_GS4` | 2 | Information Sharing, Transparency and Right to Information | published · chapter v1 | `84ac2d46-0f14-4bf3-aafa-2d009fd10fcb` |
| 146 | 4 | `UPSC_MAINS_GS4` | 2 | Laws, Rules, Regulations and Conscience as Ethical Guidance | published · chapter v1 | `86d97d3c-53bb-4dec-b4c2-e6f66b7d63e5` |
| 147 | 4 | `UPSC_MAINS_GS4` | 2 | Work Culture, Service Delivery and Utilization of Public Funds | — none | `fa966fbd-ad0a-43e5-81b8-1371972b6c18` |
| 148 | 4 | `UPSC_PRE_CSAT` | 1 | Interpersonal Skills including Communication Skills | published · chapter v1 | `3249ad2e-7bc8-45dd-83ce-8c2759a91d52` |
| 149 | 4 | `UPSC_PRE_GS1` | 2 | Demographics | — none | `8ee20c84-a5bc-4379-a721-9b54c7aa2b84` |
| 150 | 4 | `UPSC_PRE_GS1` | 2 | Panchayati Raj | published · chapter v1 | `32dc09ab-91c5-485b-ad74-cfba5145788a` |
| 151 | 3 | `UPSC_MAINS_GS1` | 2 | Colonial Economy and Land Revenue Systems | — none | `7b24d819-f920-401a-a68d-6aac2bc8361e` |
| 152 | 3 | `UPSC_MAINS_GS1` | 2 | Geographical Features and their Location | — none | `5a3471ed-975c-4099-a44e-7bc7cbdb6f33` |
| 153 | 3 | `UPSC_MAINS_GS1` | 2 | Nation-Building and Internal Challenges | — none | `e527c923-48c6-4a02-b32a-819ac48d7769` |
| 154 | 3 | `UPSC_MAINS_GS1` | 2 | Reorganization of States | — none | `fce63b3d-34ba-4368-be0e-af337ba25df3` |
| 155 | 3 | `UPSC_MAINS_GS2` | 2 | Historical Underpinnings, Evolution and Features | published · chapter v2 | `76e7da5c-d818-4bff-92d8-a5a90b7c152c` |
| 156 | 3 | `UPSC_MAINS_GS2` | 2 | Indian Diaspora | — none | `83f981da-c606-48ee-a5be-582585d7f4e7` |
| 157 | 3 | `UPSC_MAINS_GS3` | 2 | Environmental Impact Assessment | — none | `165722d1-5ed7-46ed-b8ff-b26f100f1b98` |
| 158 | 3 | `UPSC_MAINS_GS3` | 2 | Investment Models | — none | `78a24fce-2bd6-40cd-8f48-8deca93adef8` |
| 159 | 3 | `UPSC_MAINS_GS4` | 1 | Attitude | — none | `08aaa518-9b54-4ef4-bcb6-0a6c3af7b221` |
| 160 | 3 | `UPSC_MAINS_GS4` | 2 | Codes of Ethics, Codes of Conduct and Citizen's Charters | — none | `e2293d33-ef7d-4a20-bf60-82a5311e3609` |
| 161 | 3 | `UPSC_MAINS_GS4` | 2 | Dimensions of Ethics | — none | `795ba849-2b81-4134-91c3-a0fc9942f1f0` |
| 162 | 3 | `UPSC_MAINS_GS4` | 2 | Empathy, Tolerance and Compassion Towards the Weaker Sections | — none | `8c1ec366-9acc-4b68-a7f4-eeecc4a4b05d` |
| 163 | 3 | `UPSC_MAINS_GS4` | 2 | Ethics in Private and Public Relationships | — none | `df17fc16-e539-4208-b355-008705035cf1` |
| 164 | 3 | `UPSC_MAINS_GS4` | 2 | Influence and Relation with Thought and Behaviour | — none | `8dd091ef-7fce-4811-b153-d0df180e129e` |
| 165 | 3 | `UPSC_MAINS_GS4` | 2 | Objectivity and Dedication to Public Service | — none | `a3a148de-0616-4a57-892f-775e38d76602` |
| 166 | 2 | `UPSC_MAINS_ESSAY` | 1 | Keeping Closely to the Subject | published · chapter v1 | `3a26ca15-7176-4048-ba81-03f2b84f6997` |
| 167 | 2 | `UPSC_MAINS_GS1` | 2 | Changes in Critical Geographical Features | — none | `ba083834-26cf-4358-af69-0b7ea2200883` |
| 168 | 2 | `UPSC_MAINS_GS1` | 2 | Colonization and Decolonization | — none | `bc683cb3-66bc-43ba-aaa0-346cd3a38041` |
| 169 | 2 | `UPSC_MAINS_GS1` | 2 | Early Nationalist Phase | — none | `5e3858b7-8e06-49b7-98eb-0c163509f00a` |
| 170 | 2 | `UPSC_MAINS_GS1` | 2 | Industrial Revolution | — none | `3feee3cb-f0c3-4dfb-a4a3-eb66a355e912` |
| 171 | 2 | `UPSC_MAINS_GS1` | 2 | Political Philosophies — Communism, Capitalism and Socialism | — none | `5a134895-bb2a-4f68-9d9d-855208e19320` |
| 172 | 2 | `UPSC_MAINS_GS1` | 2 | World Wars and the Redrawal of National Boundaries | — none | `905fa16a-4a71-4069-a810-96a13bb4e606` |
| 173 | 2 | `UPSC_MAINS_GS2` | 2 | Appointment to Constitutional Posts and Constitutional Bodies | published · chapter v3 | `0d72f611-973f-441a-b8a3-8fff17176be4` |
| 174 | 2 | `UPSC_MAINS_GS3` | 2 | Achievements of Indians in Science and Technology | published · chapter v1 | `ac9492f6-3116-4511-8ec0-cd85c6dbea0a` |
| 175 | 2 | `UPSC_MAINS_GS3` | 2 | Communication Networks, Media and Social Networking Sites | — none | `5f7d3f5c-f3ec-41b9-99eb-b47cc9da8b54` |
| 176 | 2 | `UPSC_MAINS_GS3` | 2 | Technology Missions and Economics of Animal-Rearing | — none | `8eb467ad-c211-46fe-8042-d664ce2ff3b4` |
| 177 | 2 | `UPSC_MAINS_GS3` | 2 | Various Security Forces and Agencies and Their Mandate | — none | `0b5b9167-3387-49ee-a876-5e3610342d74` |
| 178 | 2 | `UPSC_MAINS_GS4` | 2 | Accountability, Ethical Governance and Strengthening Moral Values | published · chapter v1 | `950630ef-0b76-45e7-a1ab-7a996aa3a1ba` |
| 179 | 2 | `UPSC_MAINS_GS4` | 2 | Human Values: Lessons from Great Leaders and Role of Institutions | — none | `71039c08-783c-47da-b91a-28cba6f44304` |
| 180 | 2 | `UPSC_MAINS_GS4` | 2 | Integrity, Impartiality and Non-Partisanship | — none | `873e7330-afe4-4c47-8b7d-52913d7a3be1` |
| 181 | 2 | `UPSC_MAINS_GS4` | 2 | Moral Thinkers and Philosophers from the World | — none | `44e01376-aec2-4f73-b63f-c0a4c12a4aa6` |
| 182 | 2 | `UPSC_MAINS_GS4` | 2 | Status and Problems of Public Service Values | — none | `94a19b65-0a58-4278-b0d2-fcb29103f2fa` |
| 183 | 1 | `UPSC_MAINS_ESSAY` | 1 | Concise Writing | published · chapter v1 | `9e26af0d-c4e3-4d1b-a14f-ff2a95021943` |
| 184 | 1 | `UPSC_MAINS_ESSAY` | 1 | Orderly Arrangement of Ideas | published · chapter v1 | `f591e4a4-45a9-437e-b1de-4b4366cc64b3` |
| 185 | 1 | `UPSC_MAINS_GS1` | 2 | Contributors/Contributions from Different Parts of the Country | — none | `70bb7085-7a04-4eba-b0e3-871d265bd5f9` |
| 186 | 1 | `UPSC_MAINS_GS1` | 2 | Integration of Princely States | — none | `e7f6f14c-88bb-48c4-a561-e624f3ca76b1` |
| 187 | 1 | `UPSC_MAINS_GS1` | 2 | Peasant, Tribal and Labour Movements | — none | `057d511f-ca60-4831-959b-47f2e7c4ed29` |
| 188 | 1 | `UPSC_MAINS_GS1` | 2 | Revolutionary Movements | — none | `8b2b128e-8adc-4c86-80da-03d7d23e8d66` |
| 189 | 1 | `UPSC_MAINS_GS3` | 2 | E-technology in the Aid of Farmers | — none | `eb1b061e-8e7a-4112-ac39-aa2907ce6ae3` |
| 190 | 1 | `UPSC_MAINS_GS3` | 2 | Indian Economy: Planning and Mobilization of Resources | — none | `ef390cb0-42e4-48e4-8d0b-48e189bc7d23` |
| 191 | 1 | `UPSC_MAINS_GS4` | 2 | Application in Administration and Governance | — none | `3697e4ed-e35a-4ba4-b440-b42cb533e5ba` |
| 192 | 1 | `UPSC_PRE_GS1` | 2 | Social Geography | — none | `16e8f78d-fd89-4a71-9efc-15de93090965` |
| 193 | 0 | `UPSC_MAINS_GS3` | 2 | Indigenization of Technology and Developing New Technology | — none | `ec28407f-6ec8-4bb2-9af2-118a58467a0e` |
| 194 | 0 | `UPSC_MAINS_GS4` | 2 | Attitude: Content, Structure and Function | — none | `57a2fa61-c571-4e5b-b456-fdcec4ab0f23` |
| 195 | 0 | `UPSC_MAINS_GS4` | 2 | Moral and Political Attitudes; Social Influence and Persuasion | — none | `1e78d128-7627-434a-bc36-01474522e7d5` |
