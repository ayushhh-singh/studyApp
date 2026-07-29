-- Sukoon F4 — seed 60 guided journal prompts (blueprint F4), fully bilingual.
--
-- text_hi and text_en are each written NATURALLY in their language (not literal
-- translations of one another), warm, in the peer register (तुम), with the
-- code-mixing real aspirants use (mock/Exam/Result/rank). NONE of the banned
-- clinical words appear (therapy/diagnosis/patient/… — SUKOON_CONTEXT). Tone was
-- approved on a 10-prompt sample before this full set was written.
--
-- category  : reflection | gratitude | worry_dump | mock_review | result_feelings
--             | comparison | parental | self_compassion | letter_future
-- exam_phase: routine (everyday) | pre_exam | post_result
--             (the blueprint's "prep/any" map onto "routine" here.)
--
-- Idempotent: upsert by the stable `key` (0081), so re-running or editing a
-- prompt re-applies cleanly and never duplicates.

insert into public.sukoon_journal_prompts (key, text_hi, text_en, category, exam_phase, active) values
-- reflection (daily reflection) --------------------------------------------
($t$reflection_01$t$, $t$आज का दिन कैसा बीता? कोई एक पल जो मन में ठहर गया — अच्छा हो या मुश्किल, दोनों ठीक हैं।$t$, $t$How did today actually feel? Write about one moment that stayed with you — good or hard, both are okay.$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_02$t$, $t$आज तुमने खुद के बारे में एक छोटी-सी बात नई महसूस की हो — क्या थी वो?$t$, $t$Did you notice one small new thing about yourself today? What was it?$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_03$t$, $t$आज दिन में एक पल ऐसा था जब मन थोड़ा हल्का लगा? उस पल को यहाँ लिखकर एक बार और जी लो।$t$, $t$Was there a moment today when things felt a little lighter? Live it once more by writing it down.$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_04$t$, $t$अगर आज के दिन को एक शब्द देना हो, तो कौन सा? और वो शब्द ही क्यों चुना?$t$, $t$If today had to be one word, what would it be — and why that word?$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_05$t$, $t$आज किस चीज़ ने तुम्हारी ऊर्जा खींच ली, और किसने उसे चुपचाप वापस भर दिया?$t$, $t$What drained your energy today, and what quietly filled it back up?$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_06$t$, $t$आज किसी छोटी-सी बात पर मुस्कुरा दिए थे? उसे यहाँ संभालकर रख लो।$t$, $t$Did something small make you smile today? Tuck it away here so it lasts.$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_07$t$, $t$मन अभी किस रफ़्तार पर है — भाग रहा है, थमा हुआ है, या कहीं बीच में? बस महसूस करके लिख दो।$t$, $t$What speed is your mind at right now — racing, still, or somewhere in between? Just feel it and write.$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_08$t$, $t$आज का सबसे शांत पल कौन-सा था? उस ठहराव को शब्दों में पकड़ने की कोशिश करो।$t$, $t$What was the calmest moment of your day? Try to catch that quiet in words.$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_09$t$, $t$आज कोई ऐसी बात हुई जिसे तुम कल के 'तुम' को याद दिलाना चाहोगे?$t$, $t$Did anything happen today that tomorrow-you would want to be reminded of?$t$, $t$reflection$t$, $t$routine$t$, true),
($t$reflection_10$t$, $t$Exam पास आ रहा है और घबराहट होना बिलकुल इंसानी बात है। अभी यह घबराहट शरीर और मन में कहाँ महसूस होती है — और उसे क्या सुनना चाहिए?$t$, $t$The exam is getting close, and the nerves are completely human. Where do you feel them in your body and mind right now — and what do they need to hear?$t$, $t$reflection$t$, $t$pre_exam$t$, true),
-- gratitude -----------------------------------------------------------------
($t$gratitude_01$t$, $t$आज की तीन छोटी-छोटी चीज़ें जिनके लिए मन ने चुपचाप शुक्रिया कहा — चाय की पहली घूँट भी गिनती में है।$t$, $t$Three small things that felt worth a quiet thank-you today — the first sip of chai counts too.$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_02$t$, $t$कोई एक इंसान जिसकी आज मौजूदगी अच्छी लगी — उन्हें मन ही मन क्या कहना चाहोगे?$t$, $t$One person whose presence felt good today — what would you say to them, even just in your head?$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_03$t$, $t$आज अपने शरीर का शुक्रिया किस बात के लिए कहना चाहोगे? उसने दिनभर तुम्हें संभाला है।$t$, $t$What would you thank your body for today? It carried you all day.$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_04$t$, $t$तुम्हारे पास आज ऐसी कौन-सी चीज़ है जिसे हम अक्सर हल्के में ले लेते हैं?$t$, $t$What's something you have today that's easy to take for granted?$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_05$t$, $t$पढ़ाई की इस पूरी राह में कोई एक चीज़ जिसके लिए तुम सच में आभारी हो?$t$, $t$One thing on this whole exam journey you're genuinely grateful for?$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_06$t$, $t$आज किसी ने, चाहे कितना भी छोटा, तुम्हारा साथ दिया हो — वो पल याद करो।$t$, $t$Someone was there for you today, however small the gesture — bring that moment back.$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_07$t$, $t$बीते हफ़्ते का एक पल जिसके लिए 'शुक्र है' अपने आप निकल आया?$t$, $t$A moment from this past week that made a quiet 'thank goodness' slip out?$t$, $t$gratitude$t$, $t$routine$t$, true),
($t$gratitude_08$t$, $t$आज खुद की किस एक कोशिश के लिए तुम खुद को शुक्रिया कह सकते हो?$t$, $t$One effort of your own today that you can thank yourself for?$t$, $t$gratitude$t$, $t$routine$t$, true),
-- worry_dump ----------------------------------------------------------------
($t$worry_dump_01$t$, $t$जो भी बोझ मन पर बैठा है, यहाँ बेझिझक उड़ेल दो। किसी को पढ़ना नहीं है — बस उसे सिर से बाहर निकलने दो।$t$, $t$Whatever's sitting heavy on your mind, pour it all out here. No one's reading this — just let it leave your head.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_02$t$, $t$अभी सबसे ज़्यादा किस बात की चिंता है? उसे पूरा, बिना सजाए, लिख डालो।$t$, $t$What are you most anxious about right now? Write it all out, unpolished.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_03$t$, $t$मन में कौन-सा 'क्या हुआ तो?' बार-बार लौट आता है? उसे कागज़ पर रख दो, ताकि सिर थोड़ा हल्का हो।$t$, $t$Which 'what if' keeps circling back? Set it down here so your head gets a little lighter.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_04$t$, $t$जो डर तुम किसी से कह नहीं पाते, वो यहाँ कह दो। यह जगह पूरी तरह तुम्हारी है।$t$, $t$The fear you can't say out loud to anyone — say it here. This space is completely yours.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_05$t$, $t$अभी शरीर में तनाव कहाँ महसूस हो रहा है — कंधे, जबड़ा, पेट? वहीं से शुरू करो और लिखते जाओ।$t$, $t$Where's the tension sitting in your body right now — shoulders, jaw, stomach? Start there and keep writing.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_06$t$, $t$Exam को लेकर मन में जो सबसे बड़ा डर है, उसे एक नाम दो। नाम मिलते ही डर अक्सर थोड़ा छोटा हो जाता है।$t$, $t$Give a name to your biggest fear about the exam. Fears often shrink a little the moment they're named.$t$, $t$worry_dump$t$, $t$pre_exam$t$, true),
($t$worry_dump_07$t$, $t$जो टू-डू लिस्ट सिर में घूम रही है, उसे यहाँ खाली कर दो — क्रम की चिंता मत करो।$t$, $t$The to-do list spinning in your head — empty it out here. Don't worry about the order.$t$, $t$worry_dump$t$, $t$routine$t$, true),
($t$worry_dump_08$t$, $t$आज किस बात ने तुम्हें सबसे ज़्यादा बेचैन किया? उससे ऐसे बात करो जैसे वो सामने बैठी हो।$t$, $t$What unsettled you most today? Talk to it as if it were sitting right in front of you.$t$, $t$worry_dump$t$, $t$routine$t$, true),
-- mock_review ---------------------------------------------------------------
($t$mock_review_01$t$, $t$आज के mock में एक चीज़ जो अच्छी रही, और एक जो अगली बार अलग करोगे। नंबर की बात नहीं — बस एक सीख।$t$, $t$One thing that went right in today's mock, and one you'd do differently next time. Forget the score — just the lesson.$t$, $t$mock_review$t$, $t$routine$t$, true),
($t$mock_review_02$t$, $t$आज के test के दौरान मन कब भटका, और कब पूरी तरह टिका रहा? उस फ़र्क़ पर ग़ौर करो।$t$, $t$During today's test, when did your mind wander and when was it fully locked in? Notice the difference.$t$, $t$mock_review$t$, $t$routine$t$, true),
($t$mock_review_03$t$, $t$जो सवाल ग़लत हुए — उनमें कितने 'आता ही नहीं था' और कितने 'जल्दबाज़ी'? खुद से ईमानदारी से पूछो।$t$, $t$Of the questions you got wrong — how many were 'didn't know it' versus 'rushed it'? Ask yourself honestly.$t$, $t$mock_review$t$, $t$routine$t$, true),
($t$mock_review_04$t$, $t$आज का score तुम्हारी पूरी मेहनत की कहानी नहीं है। कहानी का बाक़ी हिस्सा यहाँ लिखो।$t$, $t$Today's score isn't the whole story of your effort. Write the rest of that story here.$t$, $t$mock_review$t$, $t$routine$t$, true),
($t$mock_review_05$t$, $t$इस mock ने तुम्हें अपने बारे में क्या दिखाया — पढ़ाई से परे, हिम्मत या धैर्य के बारे में?$t$, $t$What did this mock show you about yourself — beyond studies, about your grit or patience?$t$, $t$mock_review$t$, $t$routine$t$, true),
($t$mock_review_06$t$, $t$अगर यही test किसी दोस्त ने दिया होता और यही score लाता, तो तुम उससे क्या कहते? वही बात खुद से कहो।$t$, $t$If a friend took this same test and got this score, what would you tell them? Now say that to yourself.$t$, $t$mock_review$t$, $t$routine$t$, true),
-- result_feelings -----------------------------------------------------------
($t$result_feelings_01$t$, $t$Result आने के बाद अभी अंदर क्या चल रहा है? जो भी है — राहत, मायूसी, या सुन्नपन — उसे शब्द देने की कोशिश करो।$t$, $t$What's moving inside you since the result came out? Whatever it is — relief, disappointment, numbness — try giving it words.$t$, $t$result_feelings$t$, $t$post_result$t$, true),
($t$result_feelings_02$t$, $t$यह result तुम्हारी क़ीमत तय नहीं करता। फिर भी अभी जो चुभ रहा है, उसे यहाँ रखो — दबाओ मत।$t$, $t$This result doesn't decide your worth. Still, whatever's stinging right now, put it here — don't bury it.$t$, $t$result_feelings$t$, $t$post_result$t$, true),
($t$result_feelings_03$t$, $t$इस पल में तुम्हें सबसे ज़्यादा किस बात की ज़रूरत है — आराम, हिम्मत, या बस थोड़ा रो लेना? खुद को वो देने की इजाज़त दो।$t$, $t$What do you need most in this moment — rest, courage, or just a good cry? Give yourself permission to have it.$t$, $t$result_feelings$t$, $t$post_result$t$, true),
($t$result_feelings_04$t$, $t$अगर आज का 'तुम' एक साल बाद वाले 'तुम' से एक बात कह सके, तो क्या कहोगे?$t$, $t$If today's you could say one thing to the you a year from now, what would it be?$t$, $t$result_feelings$t$, $t$post_result$t$, true),
($t$result_feelings_05$t$, $t$इस नतीजे से परे, इस पूरी तैयारी में तुम जो बने — वो कोई नहीं छीन सकता। वो क्या है?$t$, $t$Beyond this outcome, who you became through all this prep — no one can take that away. What is it?$t$, $t$result_feelings$t$, $t$post_result$t$, true),
($t$result_feelings_06$t$, $t$घरवालों या खुद की उम्मीदों का जो बोझ अभी महसूस हो रहा है, उसे यहाँ उतार दो।$t$, $t$The weight of everyone's expectations — or your own — that you feel right now, set it down here.$t$, $t$result_feelings$t$, $t$post_result$t$, true),
-- comparison ----------------------------------------------------------------
($t$comparison_01$t$, $t$किसी और की तैयारी या रैंक देखकर आज मन कहीं छोटा लगा? उस पल के पास थोड़ी देर बैठो — फिर खुद से वैसे बात करो जैसे किसी थके दोस्त से करते।$t$, $t$Did seeing someone else's prep or rank make you feel smaller today? Sit with that moment a while — then talk to yourself the way you would to a tired friend.$t$, $t$comparison$t$, $t$routine$t$, true),
($t$comparison_02$t$, $t$जिससे तुम खुद की तुलना कर रहे हो, उसकी सिर्फ़ एक झलक दिखती है, पूरी कहानी नहीं। तुम्हारी अपनी कहानी में आज क्या ख़ास था?$t$, $t$You only see a glimpse of the person you're comparing yourself to, never their whole story. What was special in your own story today?$t$, $t$comparison$t$, $t$routine$t$, true),
($t$comparison_03$t$, $t$सोशल मीडिया पर किसी की 'perfect' पढ़ाई देखकर मन कैसा हुआ? उस भावना को बिना जज किए लिखो।$t$, $t$How did it feel seeing someone's 'perfect' study grind online? Write that feeling down without judging it.$t$, $t$comparison$t$, $t$routine$t$, true),
($t$comparison_04$t$, $t$छह महीने पहले वाले खुद से आज तुम कहाँ आगे हो? असल में यही एकमात्र तुलना तुम्हारी अपनी है।$t$, $t$Compared to you six months ago, where have you moved forward? That's really the only comparison that's yours.$t$, $t$comparison$t$, $t$routine$t$, true),
($t$comparison_05$t$, $t$अगर तुलना की एक आवाज़ होती, तो आज वो तुमसे क्या कह रही थी? और तुम उसे क्या जवाब देना चाहोगे?$t$, $t$If comparison had a voice, what was it telling you today? And what would you want to say back to it?$t$, $t$comparison$t$, $t$routine$t$, true),
($t$comparison_06$t$, $t$तुम्हारी अपनी रफ़्तार तुम्हारी है — किसी और की घड़ी से नहीं चलती। आज अपनी रफ़्तार को किस बात के लिए शाबाशी दोगे?$t$, $t$Your pace is your own — it doesn't run on anyone else's clock. What would you give your own pace a pat on the back for today?$t$, $t$comparison$t$, $t$routine$t$, true),
-- parental ------------------------------------------------------------------
($t$parental_01$t$, $t$घरवालों की उम्मीदें कभी प्यार लगती हैं, कभी बोझ — और अक्सर दोनों एक साथ। इनमें से कौन-सा सपना सच में तुम्हारा अपना है, और कौन-सा किसी और का?$t$, $t$Family expectations can feel like love and weight at once. Of all of them, which dream is truly yours — and which one belongs to someone else?$t$, $t$parental$t$, $t$routine$t$, true),
($t$parental_02$t$, $t$अगर तुम अपने घरवालों से बिना किसी डर के एक बात कह पाते, तो क्या कहते? यहाँ अभ्यास कर लो।$t$, $t$If you could tell your family one thing without any fear, what would it be? Rehearse it here.$t$, $t$parental$t$, $t$routine$t$, true),
($t$parental_03$t$, $t$उनकी चिंता के पीछे अक्सर उनका अपना डर छुपा होता है। आज उनकी किसी बात को उस नज़र से देख पाए?$t$, $t$Behind their worry there's often their own fear hiding. Could you see something they said today through that lens?$t$, $t$parental$t$, $t$routine$t$, true),
($t$parental_04$t$, $t$घर पर 'कैसी चल रही है तैयारी?' सुनकर अंदर क्या होता है? उस पल की सच्चाई लिख दो।$t$, $t$What happens inside you when you hear 'so how's the prep going?' at home? Write the honest truth of that moment.$t$, $t$parental$t$, $t$routine$t$, true),
($t$parental_05$t$, $t$तुम अपने घरवालों से जो सुनना चाहते हो पर सुन नहीं पाते — वो शब्द यहाँ खुद से कह दो।$t$, $t$The words you wish you'd hear from your family but don't — say them to yourself here.$t$, $t$parental$t$, $t$routine$t$, true),
($t$parental_06$t$, $t$तुम्हारी मेहनत तुम्हारी है, किसी को साबित करने के लिए नहीं। आज तुमने सिर्फ़ अपने लिए क्या किया?$t$, $t$Your effort is yours, not something to prove to anyone. What did you do today just for yourself?$t$, $t$parental$t$, $t$routine$t$, true),
-- self_compassion -----------------------------------------------------------
($t$self_compassion_01$t$, $t$आज खुद के लिए एक नरम-सी बात लिखो — ठीक वही जो तुम अपने सबसे करीबी दोस्त से कहते, अगर वो इतना थका होता।$t$, $t$Write one gentle line to yourself today — the exact words you'd offer your closest friend if they were this worn out.$t$, $t$self_compassion$t$, $t$routine$t$, true),
($t$self_compassion_02$t$, $t$आज जो कर पाए, उसे गिनो — कितना भी कम लगे। हर छोटी कोशिश मायने रखती है।$t$, $t$Count what you did manage today — however small it feels. Every small effort counts.$t$, $t$self_compassion$t$, $t$routine$t$, true),
($t$self_compassion_03$t$, $t$जिस ग़लती के लिए तुम खुद को माफ़ नहीं कर पा रहे, उसे आज थोड़ी नरमी दो। तुम इंसान हो, मशीन नहीं।$t$, $t$The mistake you can't seem to forgive yourself for — offer it some softness today. You're human, not a machine.$t$, $t$self_compassion$t$, $t$routine$t$, true),
($t$self_compassion_04$t$, $t$अगर आज का दिन मुश्किल था, तो यह कहना बिलकुल ठीक है: 'आज बस टिके रहना ही काफ़ी था।' इसे यहाँ लिखो।$t$, $t$If today was hard, it's completely okay to say: 'just staying afloat today was enough.' Write that here.$t$, $t$self_compassion$t$, $t$routine$t$, true),
($t$self_compassion_05$t$, $t$अपने अंदर के कठोर आलोचक को आज एक दिन की छुट्टी दे दो। उसकी जगह खुद से क्या कहना चाहोगे?$t$, $t$Give your inner critic the day off today. What would you rather say to yourself instead?$t$, $t$self_compassion$t$, $t$routine$t$, true),
($t$self_compassion_06$t$, $t$थकान कमज़ोरी नहीं है — यह इस बात का सबूत है कि तुम लगे हुए हो। आज अपने आराम को बिना गिल्ट के किस तरह लोगे?$t$, $t$Being tired isn't weakness — it's proof you've been showing up. How will you take your rest today, without the guilt?$t$, $t$self_compassion$t$, $t$routine$t$, true),
-- letter_future -------------------------------------------------------------
($t$letter_future_01$t$, $t$एक साल बाद वाले 'तुम' को एक छोटी चिट्ठी लिखो। उसे क्या बताना चाहोगे — कि आज तुमने किस तरह हिम्मत बनाए रखी?$t$, $t$Write a short letter to the 'you' from one year ahead. What would you want them to know about how you held on today?$t$, $t$letter_future$t$, $t$routine$t$, true),
($t$letter_future_02$t$, $t$उस दिन के 'तुम' को लिखो जब यह पूरा सफ़र ख़त्म हो चुका होगा। उससे क्या वादा करना चाहोगे?$t$, $t$Write to the 'you' on the day this whole journey is finally over. What promise would you want to make them?$t$, $t$letter_future$t$, $t$routine$t$, true),
($t$letter_future_03$t$, $t$पाँच साल बाद, जब यह पूरा दौर बस एक याद बन जाएगा — तब का 'तुम' आज के तुम्हें क्या कहकर दिलासा देगा?$t$, $t$Five years from now, when all of this is just a memory — what would that 'you' say to comfort today's you?$t$, $t$letter_future$t$, $t$routine$t$, true),
($t$letter_future_04$t$, $t$आज के संघर्ष के बीच, आने वाले 'तुम' को एक बात याद दिला दो जिसे वो शायद भूल जाए।$t$, $t$In the middle of today's struggle, remind your future self of one thing they might forget.$t$, $t$letter_future$t$, $t$routine$t$, true)
-- `key` is a PARTIAL unique index (where key is not null, 0081) — the ON CONFLICT
-- arbiter must repeat that predicate to match it. Every seeded row has a key.
on conflict (key) where key is not null do update set
  text_hi    = excluded.text_hi,
  text_en    = excluded.text_en,
  category   = excluded.category,
  exam_phase = excluded.exam_phase,
  active     = excluded.active;
