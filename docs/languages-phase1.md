# AnimBook Languages — Phase 1 Build Spec

**For:** MiniMax Code (coding agent)
**Project:** AnimBook (www.animbook.com)
**Feature:** A new interactive language-learning section built on animated stories
**Phase 1 languages:** English, French, Spanish, Chinese (Mandarin, Simplified), German, Italian, Hebrew
**Base (instruction) languages:** English and French

---

## 0. Instructions to the agent — read first

1. **Inspect the existing AnimBook codebase before writing anything.** Identify the framework, language, ORM, database, auth system, file/media storage, job queue, and how the Studio pipeline (stills → animation clips → ElevenLabs narration) is structured. Report this summary back before Patch 01.
2. **Match the existing stack and conventions.** The schemas and endpoints below are written in neutral Postgres/REST form. Translate them into the project's actual ORM, migration tool, routing style and component library. Do not introduce a second framework.
3. **Do not break existing features.** The Studio pipeline and book-to-animation flow must keep working. The Languages section reuses Studio services by calling them, not by modifying their behaviour. If a Studio change is unavoidable, make it additive and flag it.
4. **Work in numbered patches** (Section 12). Each patch must be self-contained, include its migration(s), and meet its acceptance criteria. Stop after each patch, summarise what changed, list any files touched outside the Languages module, and wait for approval.
5. **Keep all Languages code in its own module/folder** (e.g. `languages/` on the backend and `features/languages/` on the frontend, or the project's equivalent).
6. **Secrets go in environment variables only.** Never hard-code API keys.
7. **If anything in this spec conflicts with how the codebase works, ask rather than guess.**

---

## 1. Product summary

Learners pick a language they want to learn and a language they already know (English or French). AnimBook teaches them through short animated stories. While watching, learners tap any word in the subtitles to see its meaning and hear it, and save it to their personal vocabulary deck. After each scene they do short exercises: comprehension questions, sentence building, listening, and speaking a character's line aloud for a pronunciation score. Saved words come back in spaced-repetition review sessions. Progress, XP and streaks keep learners returning.

Core principle: **the story is the lesson.** Every exercise comes from the story the learner just watched.

---

## 2. Phase 1 scope

### In scope
- 7 target languages × 2 base languages (a learner cannot pick the same language as both).
- Level A1 content (the schema must support A1–C2 for later).
- Interactive story player with tap-to-learn subtitles.
- Word popup: meaning, pronunciation audio, part of speech, save to deck.
- 5 exercise types (Section 8).
- Pronunciation practice with a score (Section 9).
- Vocabulary deck with FSRS spaced repetition (Section 10).
- XP, daily streak, per-course progress.
- Content pipeline to generate, review and publish lessons (Section 6).
- Admin review screen for human approval of every language version.
- Full RTL support for Hebrew; pinyin + tones for Chinese; niqqud for Hebrew.

### Out of scope (later phases)
- AI conversation tutor (Phase 2).
- Local/Cameroonian languages (later phase).
- Levels above A1 content (schema ready, content later).
- Traditional Chinese characters.
- Leaderboards, social features, certificates.
- Offline mode.

---

## 3. Language configuration

Store as a seeded `languages` table (and mirror as a typed constant on the frontend).

| code | name (en) | name (native) | direction | script | reading aid | STT code | notes |
|---|---|---|---|---|---|---|---|
| `en` | English | English | ltr | Latin | none | `en` | also a base language |
| `fr` | French | Français | ltr | Latin | none | `fr` | also a base language |
| `es` | Spanish | Español | ltr | Latin | none | `es` | |
| `zh-Hans` | Chinese (Mandarin) | 中文 | ltr | Han (Simplified) | pinyin with tone marks | `zh` | word segmentation required |
| `de` | German | Deutsch | ltr | Latin | none | `de` | show noun gender (der/die/das) |
| `it` | Italian | Italiano | ltr | Latin | none | `it` | |
| `he` | Hebrew | עברית | **rtl** | Hebrew | niqqud (vowel points) | `he` | RTL layout everywhere |

Fields for the `languages` table: `code` (PK), `name_en`, `name_fr`, `name_native`, `direction`, `script`, `reading_aid` (`none` / `pinyin` / `niqqud`), `stt_code`, `tts_voice_ids` (JSON: narrator + character voices), `font_family`, `is_target` (bool), `is_base` (bool), `is_active` (bool).

**Interface language:** the app UI (buttons, menus, instructions) appears in the learner's base language. Add i18n strings for `en` and `fr` for every Languages screen.

---

## 4. Data model

Neutral Postgres DDL-style description. Adapt to the project's ORM. All tables get `id` (UUID), `created_at`, `updated_at` unless noted.

### Content tables

**courses** — one per (target, base) pair. 7 targets × 2 bases, minus English-through-English and French-through-French = 12 courses.
- `target_lang` → languages.code
- `base_lang` → languages.code
- `title`, `description`
- `is_published`
- unique (`target_lang`, `base_lang`)

**master_stories** — language-neutral story source, written once.
- `slug`, `title_en`
- `cefr_level` (`A1`…`C2`)
- `synopsis`
- `master_script` (JSON: scenes → lines, in English, with character and visual notes)
- `target_vocab_concepts` (JSON array of concepts the story teaches, e.g. "greetings", "numbers 1–10")
- `animation_status` (`pending` / `generating` / `ready` / `failed`)

**master_scenes** — the shared visuals for a scene. Animation is produced once and reused by every language.
- `master_story_id`, `order`
- `visual_prompt`, `still_url`, `clip_url`, `duration_ms`
- Rule: **generated visuals must contain no written text**, so they work in every language.

**stories** — one language version of a master story.
- `master_story_id`
- `target_lang`
- `title`, `title_translations` (JSON: `{en, fr}`)
- `cefr_level`
- `review_status` (`draft` / `in_review` / `approved` / `rejected`)
- `reviewer_id`, `reviewer_notes`
- `is_published`
- unique (`master_story_id`, `target_lang`)

**scenes**
- `story_id`, `master_scene_id`, `order`

**lines** — one spoken subtitle line.
- `scene_id`, `order`
- `speaker` (character key or `narrator`)
- `text` (target language, as displayed)
- `text_reading` (nullable: pinyin string for zh, fully pointed text for he)
- `translations` (JSON: `{en: "...", fr: "..."}`)
- `audio_url`
- `start_ms`, `end_ms` (position within the scene clip)
- `word_timings` (JSON array aligned to tokens, from TTS alignment)

**lexemes** — dictionary entries per target language.
- `target_lang`
- `lemma` (dictionary form)
- `reading` (pinyin / pointed Hebrew / null)
- `part_of_speech`
- `gender` (nullable; for de/fr/es/it/he)
- `glosses` (JSON: `{en: ["..."], fr: ["..."]}`)
- `audio_url`
- `frequency_rank` (nullable)
- unique (`target_lang`, `lemma`, `part_of_speech`)

**line_tokens** — the tappable pieces of a line.
- `line_id`, `order`
- `surface` (text as it appears in the line)
- `reading` (nullable; per-token pinyin or pointed form)
- `lexeme_id` (nullable for punctuation)
- `is_new_in_story` (bool — highlights new vocabulary)
- `start_char`, `end_char`

**exercises**
- `scene_id`, `order`
- `type` (`comprehension_mc` / `word_meaning_mc` / `sentence_builder` / `listen_select` / `speak_line`)
- `payload` (JSON — shape per type, Section 8)
- `answer` (JSON)

### Learner tables

**enrollments**
- `user_id`, `course_id`, `started_at`, `last_active_at`
- `current_story_id` (nullable)
- unique (`user_id`, `course_id`)

**story_progress**
- `user_id`, `story_id`
- `status` (`not_started` / `in_progress` / `completed`)
- `last_scene_order`, `score_pct`, `completed_at`

**exercise_attempts**
- `user_id`, `exercise_id`, `response` (JSON), `is_correct`, `score` (nullable), `created_at`

**pronunciation_attempts**
- `user_id`, `line_id`, `audio_url`, `transcript`, `score` (0–100), `details` (JSON: per-word result, tone results for zh), `created_at`

**user_vocab** — the learner's deck (FSRS card state).
- `user_id`, `lexeme_id`, `source_line_id` (where they saved it — used as the example sentence)
- FSRS fields: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `state`, `last_review`
- unique (`user_id`, `lexeme_id`)

**review_logs**
- `user_id`, `user_vocab_id`, `rating` (1–4), `review_at`, plus FSRS log fields

**learner_stats**
- `user_id` (PK)
- `xp_total`, `current_streak_days`, `longest_streak_days`, `last_activity_date`, `timezone`

---

## 5. Lesson content format (JSON)

The pipeline produces this format, the admin screen edits it, and the importer writes it to the tables above. Example (Spanish, one line shown):

```json
{
  "master_story_slug": "market-morning",
  "target_lang": "es",
  "cefr_level": "A1",
  "title": "Una mañana en el mercado",
  "title_translations": { "en": "A Morning at the Market", "fr": "Un matin au marché" },
  "scenes": [
    {
      "master_scene_order": 1,
      "lines": [
        {
          "speaker": "ana",
          "text": "¡Hola! Quiero tres mangos, por favor.",
          "text_reading": null,
          "translations": {
            "en": "Hello! I want three mangoes, please.",
            "fr": "Bonjour ! Je voudrais trois mangues, s'il vous plaît."
          },
          "tokens": [
            { "surface": "¡", "lemma": null },
            { "surface": "Hola", "lemma": "hola", "pos": "interjection", "glosses": { "en": ["hello"], "fr": ["bonjour", "salut"] }, "is_new": true },
            { "surface": "!", "lemma": null },
            { "surface": "Quiero", "lemma": "querer", "pos": "verb", "glosses": { "en": ["to want"], "fr": ["vouloir"] }, "is_new": true },
            { "surface": "tres", "lemma": "tres", "pos": "numeral", "glosses": { "en": ["three"], "fr": ["trois"] }, "is_new": true },
            { "surface": "mangos", "lemma": "mango", "pos": "noun", "gender": "m", "glosses": { "en": ["mango"], "fr": ["mangue"] }, "is_new": true },
            { "surface": ",", "lemma": null },
            { "surface": "por favor", "lemma": "por favor", "pos": "phrase", "glosses": { "en": ["please"], "fr": ["s'il vous plaît"] }, "is_new": true },
            { "surface": ".", "lemma": null }
          ]
        }
      ],
      "exercises": [
        {
          "type": "comprehension_mc",
          "payload": {
            "question": { "en": "How many mangoes does Ana want?", "fr": "Combien de mangues Ana veut-elle ?" },
            "options": ["2", "3", "5", "10"]
          },
          "answer": { "index": 1 }
        }
      ]
    }
  ]
}
```

**Chinese tokens** must include per-token `reading` in tone-marked pinyin (e.g. `"surface": "你好", "reading": "nǐ hǎo"`).
**Hebrew lines** must include `text` (unpointed, as normally written) and `text_reading` (fully pointed with niqqud); tokens carry both forms.

---

## 6. Content pipeline

Implement as background jobs using the project's existing job queue. Each step is idempotent and records status so failures can be retried.

1. **Author master story.** An admin creates a master story (or asks the LLM to draft one) with scenes, lines in English, characters and visual prompts. A1 constraints: short sentences, present tense mostly, ~6–10 scenes, ~2–4 lines per scene, ~20–30 new words total.
2. **Generate animation once.** Call the existing Studio services to produce a still and clip per master scene from `visual_prompt`. Enforce "no text in the image" in the prompt. Store on `master_scenes`.
3. **Adapt to each target language.** For each of the 7 target languages, call the LLM to write a natural version of the story (adaptation, not word-for-word translation) that follows the same scenes and timing, respects A1 vocabulary limits, and returns the JSON format in Section 5 including translations into `en` and `fr`, glosses, and exercises. Validate against a JSON schema; retry on invalid output.
4. **Language-specific processing.**
   - `zh-Hans`: verify segmentation with `jieba` and generate/verify tone-marked pinyin with `pypinyin`. Where the LLM and the library disagree, flag the token for review.
   - `he`: produce pointed text (LLM or Dicta's Nakdan service), and flag every line for mandatory human review of niqqud.
   - `de`: ensure every noun lexeme has `gender`.
5. **Lexeme upsert.** Match tokens to existing lexemes by (`target_lang`, `lemma`, `pos`); create missing ones.
6. **Narration.** Generate per-line audio with ElevenLabs using the language's configured voices, using the timestamped TTS endpoint so character-level alignment is returned. Convert alignment into `word_timings` per token. Generate one audio file per new lexeme for the word popup.
7. **Timing.** Fit lines into each scene clip's duration. If narration is longer than the clip, extend the scene by holding the last frame; never cut audio.
8. **Human review.** Story goes to `in_review`. A fluent reviewer checks text, translations, glosses, readings and audio in the admin screen, edits if needed, and approves. **Nothing is published without approval.**
9. **Publish.** Approved stories become visible in their courses for both base languages.

Keep the TTS provider behind an interface (`TtsProvider`) so ElevenLabs can later be swapped for an open-source model (e.g. XTTS) without touching the pipeline.

---

## 7. Screens

All screens use the learner's base language for UI text and support mobile first.

1. **Languages landing** — entry from AnimBook's main navigation. Explains the feature; shows the 7 languages with native names.
2. **Onboarding** — pick base language (English/French), pick target language, optional daily goal (5 / 10 / 20 minutes). Creates the enrollment.
3. **Course home** — list of stories in order with lock/progress state, streak, XP, "Review words (N due)" button.
4. **Story player** — the core screen.
   - Animated scene clip plays with line audio synced.
   - Subtitle area renders tokens as tappable spans. The currently spoken word highlights using `word_timings`.
   - Toggles: show translation, show reading aid (pinyin / niqqud), playback speed (0.75× / 1×).
   - Tap a line to replay it.
   - New words in this story are subtly underlined.
   - After each scene's lines finish, the player pauses and shows that scene's exercises.
5. **Word popup** (sheet on mobile, popover on desktop) — surface form, lemma, reading, part of speech, gender (with colour cue for de), glosses in base language, play audio, "Save to my words" button, the line it came from.
6. **Exercise views** — one component per exercise type (Section 8), with immediate feedback and XP award.
7. **Story complete** — score, XP earned, words saved, next story.
8. **Review session** — FSRS-due cards. Card front: the word (with audio). Back: meaning plus the example line from the story. Rating buttons: Again / Hard / Good / Easy.
9. **My words** — searchable deck list per course.
10. **Admin: content review** — list of stories by review status; side-by-side editor for lines, translations, tokens, readings; audio playback per line; regenerate-audio button; approve/reject with notes.

### Script and layout requirements
- Set `lang` and `dir` attributes on every element containing target-language text (`dir="rtl"` for Hebrew). Use CSS logical properties (`margin-inline-start`, etc.) so layouts mirror correctly.
- Chinese reading aid: render with HTML `<ruby>` / `<rt>` so pinyin sits above each character group.
- Hebrew reading aid: swap between unpointed `text` and pointed `text_reading`.
- Fonts: load Noto Sans SC for Chinese and Noto Sans Hebrew for Hebrew; keep existing AnimBook fonts for Latin text.
- Mixed-direction text (e.g. Hebrew line with an English translation below) must display correctly; test with bidi content.

---

## 8. Exercise types (Phase 1)

| type | what the learner does | payload | answer |
|---|---|---|---|
| `comprehension_mc` | answers a question about the scene | `question` {en, fr}, `options` [] | `index` |
| `word_meaning_mc` | picks the meaning of a word from the scene | `lexeme_id`, `options` [] (in base lang, per base) | `index` |
| `sentence_builder` | taps shuffled tokens into the correct order | `line_id`, `tokens` [] (shuffled server-side) | `order` [] |
| `listen_select` | hears a line/word and picks what was said | `audio_url`, `options` [] | `index` |
| `speak_line` | records a line from the scene and gets a score | `line_id` | none (scored, Section 9) |

For `comprehension_mc` and `word_meaning_mc`, options must be stored per base language (`options: {en: [...], fr: [...]}`) when they are in the base language.

XP: 10 per correct answer, 5 per `speak_line` attempt scoring ≥ 60, 50 per completed story, 2 per review card. Store values in config, not code.

---

## 9. Pronunciation scoring (Phase 1 approach)

Keep it simple and reliable for Phase 1; phoneme-level scoring comes later.

1. Browser records audio (MediaRecorder, max 10 seconds), uploads to storage.
2. Backend transcribes with Whisper (hosted API or self-hosted `faster-whisper`, behind an `SttProvider` interface) using the language's `stt_code`, with the expected line as the prompt hint.
3. Normalise both expected text and transcript (lowercase, strip punctuation, Unicode NFC, strip niqqud for Hebrew comparison, convert Chinese to pinyin with tones via `pypinyin`).
4. Score = word-level alignment similarity (Levenshtein on tokens) mapped to 0–100. For Chinese, also compare tone numbers per syllable and report tone errors separately.
5. Return per-word results (correct / missed / different) so the UI can colour each word green or red.
6. Show the learner their score, the coloured line, and buttons to hear the native audio and try again.

Label the score as "practice score" in the UI; it is an estimate, not an assessment.

---

## 10. Spaced repetition

- Use the open-source FSRS algorithm: `ts-fsrs` (npm) if the backend is Node/TypeScript, or `fsrs` (PyPI) if Python.
- Saving a word creates a `user_vocab` card in the "new" state, due immediately.
- Review session pulls due cards (limit 20 per session by default), ordered by due date.
- Each rating updates the card via FSRS and writes a `review_logs` row.
- Course home shows the due count.

---

## 11. API endpoints (REST, adapt to project style)

All learner endpoints require auth. Admin endpoints require an admin role.

**Learner**
- `GET /api/lang/languages` — active languages
- `GET /api/lang/courses?base=fr` — courses for a base language
- `POST /api/lang/enrollments` — `{target_lang, base_lang, daily_goal}`
- `GET /api/lang/courses/:courseId` — course home data (stories, progress, stats, due count)
- `GET /api/lang/stories/:storyId?base=fr` — full player payload: scenes, clip URLs, lines, tokens, timings, exercises (translations filtered to base lang)
- `GET /api/lang/lexemes/:lexemeId?base=fr` — word popup data
- `POST /api/lang/vocab` — save word `{lexeme_id, source_line_id}`
- `DELETE /api/lang/vocab/:id`
- `GET /api/lang/vocab?course=:courseId` — my words
- `POST /api/lang/exercises/:exerciseId/attempts` — `{response}` → `{is_correct, xp_awarded}`
- `POST /api/lang/pronunciation` — multipart audio + `line_id` → score result
- `POST /api/lang/stories/:storyId/progress` — scene/complete updates
- `GET /api/lang/review/due?course=:courseId`
- `POST /api/lang/review/:userVocabId` — `{rating}`
- `GET /api/lang/stats`

**Admin**
- `POST /api/lang/admin/master-stories` — create/draft
- `POST /api/lang/admin/master-stories/:id/animate`
- `POST /api/lang/admin/master-stories/:id/adapt` — `{target_langs: [...]}`
- `GET /api/lang/admin/stories?status=in_review`
- `PUT /api/lang/admin/stories/:id` — save edits
- `POST /api/lang/admin/lines/:id/regenerate-audio`
- `POST /api/lang/admin/stories/:id/approve` / `.../reject`
- `GET /api/lang/admin/jobs/:jobId` — pipeline job status

---

## 12. Patch plan

Stop after each patch for review.

**Patch 01 — Codebase survey and module scaffold**
Report the stack summary (Section 0.1). Create the Languages module folders, route registration, i18n files for en/fr, and a placeholder landing page linked from main navigation behind a feature flag `LANGUAGES_ENABLED`.
*Accept:* app builds; landing page visible only when the flag is on; no existing behaviour changed.

**Patch 02 — Database schema and seeds**
Migrations for all tables in Section 4. Seed the 7 languages and 12 courses.
*Accept:* migrations run up and down cleanly; seed data queryable.

**Patch 03 — Content import/export and validation**
JSON schema for the Section 5 format, importer that writes a story to the tables (with lexeme upsert), and exporter back to JSON. Add one hand-written sample A1 story in Spanish and one in Hebrew as fixtures, using placeholder media.
*Accept:* fixtures import and export round-trip without data loss; invalid JSON is rejected with clear errors.

**Patch 04 — Story player (read-only)**
Player screen with clip playback, line audio, tappable tokens, highlighting via word timings, translation and reading-aid toggles, speed control. Full RTL for Hebrew, ruby pinyin for Chinese.
*Accept:* both fixtures play correctly on mobile and desktop; Hebrew layout mirrors correctly.

**Patch 05 — Onboarding, enrollments, course home**
*Accept:* a new user can choose base and target language, land on course home, open a story; progress saves per scene.

**Patch 06 — Word popup and vocabulary deck**
*Accept:* tapping a word shows popup data in the base language; saving adds to "My words"; duplicate saves are prevented.

**Patch 07 — Exercises**
All five exercise components except the scoring backend for `speak_line` (recording UI can be stubbed). Attempts recorded, XP awarded.
*Accept:* each type works on both fixtures; XP totals update.

**Patch 08 — Pronunciation scoring**
`SttProvider` interface, Whisper implementation, scoring logic per Section 9, results UI.
*Accept:* speaking a line returns a score and per-word colouring; Chinese returns tone results; Hebrew comparison ignores niqqud.

**Patch 09 — Spaced repetition review**
FSRS integration, review session screen, due counts.
*Accept:* ratings reschedule cards correctly; review logs written.

**Patch 10 — Stats, streaks, story completion**
Streak calculation using the user's timezone, story-complete screen, stats endpoint.
*Accept:* streak increments once per local day of activity and resets after a missed day.

**Patch 11 — Content pipeline jobs**
Master story authoring, animation via existing Studio services, LLM adaptation for 7 languages with schema validation and retries, zh/he/de processing, `TtsProvider` with ElevenLabs timestamped narration, timing fit.
*Accept:* one master story can be taken from draft to 7 language versions in `in_review` status with audio and timings, with job status visible.

**Patch 12 — Admin review screen and publishing**
*Accept:* reviewer can edit, regenerate audio, approve or reject; only approved stories appear to learners.

---

## 13. Environment variables

Use existing variables where the project already has them.

```
LANGUAGES_ENABLED=true
LLM_API_KEY=
LLM_MODEL=
ELEVENLABS_API_KEY=
STT_PROVIDER=whisper_api        # or faster_whisper
OPENAI_API_KEY=                 # only if using hosted Whisper
FASTER_WHISPER_MODEL=large-v3   # only if self-hosted
DICTA_NAKDAN_URL=               # optional, Hebrew niqqud
LANG_REVIEW_BATCH_SIZE=20
```

---

## 14. Quality checklist before launch

- Every published story approved by a fluent reviewer for that language.
- Hebrew niqqud and Chinese pinyin/tones checked line by line.
- Player tested on low-end Android devices and slow connections (compress clips; stream audio).
- Hebrew RTL tested on iOS Safari and Android Chrome.
- All UI strings present in both English and French.
- Microphone permission denied/blocked states handled gracefully.
- No generated visuals contain written text.
