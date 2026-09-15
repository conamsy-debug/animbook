/**
 * Phase 11 seed: production hardening.
 *
 * Adds ~20 new AnimBooks across verticals (especially the DOCS vertical
 * which had no books yet) and ~3 translated language packs.
 *
 * All text is original, public-domain, or direct procedural descriptions
 * written for AnimBook. No copyrighted material is included.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedBook {
  slug: string;
  title: string;
  author: string;
  synopsis: string;
  vertical: "DOCS" | "VERSE" | "WELLNESS" | "FAITH" | "KIDS" | "EDU" | "BUSINESS" | "TRAVEL" | "ORIGINALS" | "CONSUMER";
  genreTags: string[];
  moodTags: string[];
  ageRating?: string;
  language?: string;
  narrationLanguages?: string[];
  coverColor: string;
  pages: Array<{
    pageNum: number;
    chapter?: string;
    textExcerpt: string;
    sceneType: string;
    emotionalRegister: string;
    cameraAngle: string;
  }>;
}

const BOOKS: SeedBook[] = [
  // DOCS — the new vertical
  {
    slug: "how-to-change-a-tyre",
    title: "How to Change a Tyre",
    author: "AnimBook Docs",
    synopsis:
      "Step-by-step AnimBook. From loose lug nuts to a fully torqued wheel, every motion is on screen. The hand stays where the eye is. Read it once, change a tyre in twelve minutes.",
    vertical: "DOCS",
    genreTags: ["How-to", "Field manual", "Road safety"],
    moodTags: ["focused", "practical"],
    ageRating: "All ages",
    coverColor: "56738A",
    pages: [
      { pageNum: 1, textExcerpt: "Find a flat stretch of road off the carriageway. Press the hazard lights. Pull the handbrake. Place the triangle twenty metres behind the car.", sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "Crack the lug nuts loose before you lift the wheel. Half a turn each. The wheel will feel stuck. That is normal — rubber vulcanises to the hub.", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "Jack under the reinforced sill. Not the floor pan — the floor pan bends. Lift until the tyre clears the ground by two centimetres.", sceneType: "diagram", emotionalRegister: "cautious", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Remove the wheel. Slide the spare on. Hand-tighten the nuts in a star pattern. Lower the car.", sceneType: "diagram", emotionalRegister: "deliberate", cameraAngle: "close" },
      { pageNum: 5, textExcerpt: "Torque to manufacturer spec — usually ninety Newton-metres for a small car, one hundred and twenty for an SUV. Use the wrench until it clicks, not until it feels right.", sceneType: "diagram", emotionalRegister: "satisfied", cameraAngle: "close" },
      { pageNum: 6, textExcerpt: "Drive to the nearest tyre shop within fifty kilometres. Spare tyres are not rated for full speed.", sceneType: "establishing", emotionalRegister: "resolved", cameraAngle: "wide" }
    ]
  },
  {
    slug: "first-aid-for-the-road",
    title: "First Aid for the Road",
    author: "AnimBook Docs",
    synopsis:
      "Bleeding, choking, burns, broken bones. Four scenes, each less than ninety seconds. The action stays close enough that you can memorise the hands.",
    vertical: "DOCS",
    genreTags: ["First aid", "Emergency", "Health"],
    moodTags: ["urgent", "practical"],
    ageRating: "14+",
    coverColor: "56738A",
    pages: [
      { pageNum: 1, textExcerpt: "Scene one — bleeding. Apply firm pressure directly over the wound. Use the cleanest cloth available. Keep pressure for ten minutes. Do not lift to peek.", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "close" },
      { pageNum: 2, textExcerpt: "Scene two — choking. Five back blows between the shoulder blades. Five abdominal thrusts. Repeat until the object clears or the person stops responding.", sceneType: "diagram", emotionalRegister: "urgent", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Scene three — burns. Cool water for twenty minutes. Not ice. Remove jewellery before swelling starts. Cover loosely with cling film.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "Scene four — broken bone. Immobilise the joint above and below. Do not realign. Do not give food or water if surgery is possible.", sceneType: "diagram", emotionalRegister: "deliberate", cameraAngle: "medium" }
    ]
  },
  {
    slug: "boil-an-egg-and-other-kitchen-basics",
    title: "Boil an Egg (and Other Kitchen Basics)",
    author: "AnimBook Docs",
    synopsis:
      "Twelve kitchen fundamentals in twelve minutes. From the soft-boiled six-minute egg to the resting time on a steak. The camera is the knife.",
    vertical: "DOCS",
    genreTags: ["Cookbook", "How-to"],
    moodTags: ["warm", "practical"],
    ageRating: "All ages",
    coverColor: "56738A",
    pages: [
      { pageNum: 1, textExcerpt: "Boil an egg. Water covers the egg by two centimetres. Six minutes for soft yolk, nine for set, twelve for fully hard. Plunge into cold water for sixty seconds.", sceneType: "diagram", emotionalRegister: "warm", cameraAngle: "medium" },
      { pageNum: 2, textExcerpt: "Cook rice. One part rice, one and a half parts water. Bring to boil, lid on, lowest heat, twelve minutes. Lift the lid; the water is gone.", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "Sear a steak. Pat dry. Salt at least forty minutes ahead. Pan smoking hot. Ninety seconds per side. Rest half the cooking time.", sceneType: "diagram", emotionalRegister: "rich", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "Rest the meat. Tent with foil loosely. Five minutes minimum. The juice returns to the centre. Cut too early and the juice runs onto the plate.", sceneType: "diagram", emotionalRegister: "patient", cameraAngle: "close" }
    ]
  },
  {
    slug: "growing-tomatoes-on-a-balcony",
    title: "Growing Tomatoes on a Balcony",
    author: "AnimBook Docs",
    synopsis:
      "A balcony, one bag of compost, and a cherry tomato plant. Five scenes from seedling to first harvest. The sun does most of the work; you do the rest.",
    vertical: "DOCS",
    genreTags: ["Gardening", "How-to", "Urban"],
    moodTags: ["hopeful", "patient"],
    ageRating: "All ages",
    coverColor: "56738A",
    pages: [
      { pageNum: 1, textExcerpt: "Choose a sun-facing wall. Six hours of direct light is the minimum. Without sun, you get vine, not fruit.", sceneType: "establishing", emotionalRegister: "patient", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "Sow two seeds in a small pot, one centimetre deep. Keep moist. Thin to the strongest seedling once true leaves appear.", sceneType: "diagram", emotionalRegister: "tender", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "Transplant to a ten-litre bag when the plant has five true leaves. Bury the stem to the first set of leaves; new roots will form.", sceneType: "diagram", emotionalRegister: "deliberate", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Water deeply, less often. Mulch the surface. Feed with a potassium-rich feed once flowers appear.", sceneType: "diagram", emotionalRegister: "rhythmic", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "Pinch out the side shoots between main stem and branch. Stake the main stem. Pick fruit when fully coloured. Eat at the vine.", sceneType: "diagram", emotionalRegister: "satisfied", cameraAngle: "close" }
    ]
  },
  {
    slug: "the-six-minute-stretch",
    title: "The Six-Minute Daily Stretch",
    author: "AnimBook Docs",
    synopsis:
      "Twelve stretches, six minutes, every morning. The spine decompresses, the shoulders settle, the breath slows down. Standing on a yoga mat is optional.",
    vertical: "DOCS",
    genreTags: ["Wellness", "Movement", "Morning"],
    moodTags: ["calm", "restorative"],
    ageRating: "All ages",
    coverColor: "56738A",
    pages: [
      { pageNum: 1, textExcerpt: "Stand tall. Reach the arms overhead. Lengthen rather than strain. Breathe in for the count of four, out for six. Repeat twice.", sceneType: "diagram", emotionalRegister: "open", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "Side bend. Reach one arm over the head, the other down the side. Hold thirty seconds each.", sceneType: "diagram", emotionalRegister: "open", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Cat-cow on all fours. Inhale, arch the back, look up. Exhale, round the spine, look down. Eight rounds.", sceneType: "diagram", emotionalRegister: "fluid", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "Pigeon. Bring one shin forward, the other leg behind. Sit heavy. Breathe. Thirty seconds each side.", sceneType: "diagram", emotionalRegister: "settled", cameraAngle: "medium" }
    ]
  },
  // VERSE — expand the Lagos / city-poem universe
  {
    slug: "a-poem-for-accra",
    title: "A Poem for Accra",
    author: "AnimBook Originals",
    synopsis:
      "Twelve lines for a city that holds both the breeze and the long smoke. The drum is in the meter; the meter is in the road.",
    vertical: "VERSE",
    genreTags: ["Otherworlds", "Human Stories"],
    moodTags: ["warm", "restless"],
    coverColor: "9D4C73",
    pages: [
      { pageNum: 1, textExcerpt: "The breeze comes in from Osu at four. It lifts the laundry, it lifts the dust, it lifts the prayer flags strung between the same two mango trees.", sceneType: "establishing", emotionalRegister: "warm", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "The drums rehearse before the night remembers to be dark. The melody is older than the road that just got tarred.", sceneType: "establishing", emotionalRegister: "rhythmic", cameraAngle: "wide" },
      { pageNum: 3, textExcerpt: "Two boys share a mango. One keeps the seed. The sea will find it later, the way the sea finds everything.", sceneType: "diagram", emotionalRegister: "tender", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "The city says its name twice a day, at noon and at dusk. It says it differently each time.", sceneType: "establishing", emotionalRegister: "introspective", cameraAngle: "wide" }
    ]
  },
  {
    slug: "lagos-nights-prologue-the-bridge",
    title: "Lagos Nights · Prologue · The Bridge",
    author: "AnimBook Originals",
    synopsis:
      "Before the trilogy, before the lagoon, the bridge. A prequel AnimBook — six panels, twelve minutes. The city you cross to get to the city.",
    vertical: "VERSE",
    genreTags: ["Human Stories", "Lagos Nights"],
    moodTags: ["contemplative", "longing"],
    coverColor: "9D4C73",
    pages: [
      { pageNum: 1, textExcerpt: "The bridge is two miles long. The lagoon runs under it twice a day. The third lane is for prayers.", sceneType: "establishing", emotionalRegister: "contemplative", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "Tunde walks it every Monday. He meets the same three beggars, the same two traders, the same one motorcycle that never starts.", sceneType: "establishing", emotionalRegister: "rhythmic", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Today the beggars are quiet. The traders have rolled up their cloth. The motorcycle is gone. The bridge is just the bridge.", sceneType: "establishing", emotionalRegister: "suspenseful", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Then he hears it. Footsteps. Behind him. Closing.", sceneType: "diagram", emotionalRegister: "suspenseful", cameraAngle: "close" }
    ]
  },
  // WELLNESS — DREAM-tier originals
  {
    slug: "a-walk-through-the-rain",
    title: "A Walk Through the Rain",
    author: "AnimBook Originals",
    synopsis:
      "Eight minutes at 0.7× narration. The Reader auto-applies DREAM. The rain is on glass, then it is on leaves, then it is on the narrator's face.",
    vertical: "WELLNESS",
    genreTags: ["Sleep story", "Mindfulness"],
    moodTags: ["calm", "soft", "melancholy"],
    ageRating: "All ages",
    coverColor: "3F8172",
    pages: [
      { pageNum: 1, textExcerpt: "First it is on the window — a soft tapping, two drops together. Then it is on the eaves. Then it is on the path, where the gravel turns a deeper shade.", sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "I open the door. The air is heavier than I expected. I step into the rain as if into a lake.", sceneType: "diagram", emotionalRegister: "gentle", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "The leaves hold the water for a beat before letting it fall. Every leaf a small reservoir, briefly. Every leaf a small goodbye.", sceneType: "diagram", emotionalRegister: "tender", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "By the time I round the corner the rain has stopped. I am soaked. I am calm. The world is bright on the other side of the cloud.", sceneType: "establishing", emotionalRegister: "satisfied", cameraAngle: "wide" }
    ]
  },
  {
    slug: "tide-and-bell",
    title: "Tide and Bell",
    author: "AnimBook Originals",
    synopsis:
      "A DREAM AnimBook. The tide comes in, the tide goes out, the bell rings twice. Twenty minutes of stillness. Designed for falling asleep.",
    vertical: "WELLNESS",
    genreTags: ["Sleep story", "Meditation"],
    moodTags: ["deep", "calm"],
    ageRating: "All ages",
    coverColor: "3F8172",
    pages: [
      { pageNum: 1, textExcerpt: "The tide begins at the far rocks. It moves as a single sheet, glass-green, leaving dark kelp in its wake.", sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "The bell rings twice. Each ring fades for about nine seconds before the next.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "The tide reaches the posts. It rises to the highest plank. It begins to recede.", sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide" },
      { pageNum: 4, textExcerpt: "The bell rings twice again. Each ring overlaps the one before. The sound is older than the tide.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "Now there is only the bell. The tide has stopped showing itself. The bell is enough.", sceneType: "establishing", emotionalRegister: "deep", cameraAngle: "wide" }
    ]
  },
  // FAITH — new originals (no copyrighted scripture)
  {
    slug: "psalm-of-the-market",
    title: "Psalm of the Market",
    author: "AnimBook Originals",
    synopsis:
      "A FAITH AnimBook of original devotions written for the woman with two jobs. Six scenes, six minutes. Theological advisor reviewed.",
    vertical: "FAITH",
    genreTags: ["Devotion", "Prayer"],
    moodTags: ["contemplative", "sacred"],
    ageRating: "All ages",
    coverColor: "6B2D8B",
    pages: [
      { pageNum: 1, textExcerpt: "Bless the woman with two jobs. Her hands do not know if they are tired. They keep moving anyway, the way rivers keep moving.", sceneType: "diagram", emotionalRegister: "sacred", cameraAngle: "close" },
      { pageNum: 2, textExcerpt: "Bless the man counting change at the end of a long day. His patience is the only kindness left in the till.", sceneType: "diagram", emotionalRegister: "sacred", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Bless the bus conductor who calls out the stops. He is a small liturgy in a small uniform.", sceneType: "diagram", emotionalRegister: "sacred", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Bless the child who waits at the gate. She has been told her mother is on her way. The light stays on.", sceneType: "diagram", emotionalRegister: "sacred", cameraAngle: "close" }
    ]
  },
  // KIDS — bedtime originals
  {
    slug: "the-moon-that-lost-his-hat",
    title: "The Moon That Lost His Hat",
    author: "AnimBook Originals",
    synopsis:
      "A children's AnimBook about a forgetful moon. Public-domain font of warmth, KIDS character voices, bedtime mode ready.",
    vertical: "KIDS",
    genreTags: ["Picture book", "Bedtime"],
    moodTags: ["warm", "funny"],
    ageRating: "Ages 3-8",
    coverColor: "D9872A",
    pages: [
      { pageNum: 1, textExcerpt: "The moon came up over the hill as he does every night. But tonight his hat was gone. ‘Dear me,’ he said. ‘I’ve left it somewhere.’", sceneType: "establishing", emotionalRegister: "mischievous", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "He asked the owl. ‘I saw it on the baker’s chimney,’ said the owl. ‘Or possibly the chimney of someone who is not a baker.’", sceneType: "diagram", emotionalRegister: "playful", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "He asked the fox. ‘I saw it floating on the pond,’ said the fox. ‘But I am a fox. I see things.’", sceneType: "diagram", emotionalRegister: "playful", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "He went home. There, on his own head, was his hat. He had been wearing it the whole time.", sceneType: "diagram", emotionalRegister: "warm", cameraAngle: "close" },
      { pageNum: 5, textExcerpt: "‘Goodnight, moon,’ said the small child from the window. ‘You forgot your hat again.’", sceneType: "establishing", emotionalRegister: "warm", cameraAngle: "wide" }
    ]
  },
  {
    slug: "the-fish-who-loved-music",
    title: "The Fish Who Loved Music",
    author: "AnimBook Originals",
    synopsis:
      "A KIDS AnimBook about a fish in love with the sound of a tin whistle. Public-domain, gentle, and the perfect bedtime story for Ages 4-9.",
    vertical: "KIDS",
    genreTags: ["Picture book", "Bedtime"],
    moodTags: ["gentle", "warm"],
    ageRating: "Ages 4-9",
    coverColor: "D9872A",
    pages: [
      { pageNum: 1, textExcerpt: "Below the bridge a fish was listening. A tin whistle was playing somewhere upstream and he could not stop his tail from keeping time.", sceneType: "establishing", emotionalRegister: "gentle", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "He swam closer. The reeds gave him cover. He watched a small boy on the bank, the whistle in his pocket.", sceneType: "diagram", emotionalRegister: "curious", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "The boy played a high tune. The fish leapt once, just once, into the moonlight.", sceneType: "diagram", emotionalRegister: "joyful", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "The boy said: ‘Did you see that?’ His grandfather said: ‘Yes. He wanted you to know he was listening.’", sceneType: "diagram", emotionalRegister: "tender", cameraAngle: "medium" }
    ]
  },
  // EDU — curriculum-tied original
  {
    slug: "how-a-seed-becomes-a-tree",
    title: "How a Seed Becomes a Tree",
    author: "AnimBook EDU",
    synopsis:
      "An EDU AnimBook for Grades 4-6 science, paired with an EDU checkpoint overlay. Five scenes from seed to canopy.",
    vertical: "EDU",
    genreTags: ["Biology", "Plant science"],
    moodTags: ["calm", "scientific"],
    ageRating: "8+",
    coverColor: "1A6B3C",
    pages: [
      { pageNum: 1, textExcerpt: "A seed is a tiny plant wrapped in a coat. It has enough food inside to push one root down and one shoot up.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "close" },
      { pageNum: 2, textExcerpt: "Water enters through a small hole called the micropyle. The seed swells. The coat splits.", sceneType: "diagram", emotionalRegister: "wonder", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "The root tip senses gravity and bends down. The shoot tip senses light and bends up.", sceneType: "diagram", emotionalRegister: "wonder", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "Once the leaves open, the plant begins to make its own food from sunlight, water, and air.", sceneType: "diagram", emotionalRegister: "scientific", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "In ten years, in fifty years, in two hundred, the tree stands. The seed that began it is the size of a thumbnail.", sceneType: "establishing", emotionalRegister: "patient", cameraAngle: "wide" }
    ]
  },
  // BUSINESS — L&D
  {
    slug: "the-six-feedback-loops",
    title: "The Six Feedback Loops",
    author: "AnimBook L&D",
    synopsis:
      "An L&D AnimBook for new managers. Six loops of feedback, six scenes, six minutes. SCORM 2004 ready.",
    vertical: "BUSINESS",
    genreTags: ["L&D", "Management", "Coaching"],
    moodTags: ["focused", "practical"],
    ageRating: "Corporate",
    coverColor: "B58B27",
    pages: [
      { pageNum: 1, textExcerpt: "Loop one — describe, do not judge. ‘The report arrived two days late.’ Not: ‘You’re unreliable.’ ‘Describe’ is the entry door to ‘coach.’", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "medium" },
      { pageNum: 2, textExcerpt: "Loop two — name the impact. ‘When the report is late, the planning meeting cannot start.’ Impact moves feedback from opinion to evidence.", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Loop three — ask, do not tell. ‘What got in the way?’ The answer teaches you more than your assumption. It also teaches them.", sceneType: "diagram", emotionalRegister: "focused", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Loop four — agree the next step. ‘By Friday I will see a draft of next month’s report.’ Done in the same conversation.", sceneType: "diagram", emotionalRegister: "deliberate", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "Loop five — close the loop. ‘I see the draft. Thank you. Here is what is now ready.’ Without closure, the next loop is harder.", sceneType: "diagram", emotionalRegister: "deliberate", cameraAngle: "medium" },
      { pageNum: 6, textExcerpt: "Loop six — repeat. The loop is not a one-time piece. The loop is the relationship.", sceneType: "diagram", emotionalRegister: "satisfied", cameraAngle: "wide" }
    ]
  },
  // TRAVEL — second city guide
  {
    slug: "a-rainy-afternoon-in-cape-town",
    title: "A Rainy Afternoon in Cape Town",
    author: "AnimBook Originals",
    synopsis:
      "A TRAVEL AnimBook for the slow traveller. Five scenes in the rain — Bo-Kaap, the Company Gardens, the kelp-strewn Atlantic.",
    vertical: "TRAVEL",
    genreTags: ["The World", "Cities"],
    moodTags: ["warm", "weathered"],
    coverColor: "14818E",
    pages: [
      { pageNum: 1, textExcerpt: "Bo-Kaap looks like a row of painted wedding cakes in the rain. The cobbles are slick, the doors are not. The smell of curry is in every doorway.", sceneType: "establishing", emotionalRegister: "warm", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "In the Company Gardens the squirrels argue over the same acorn. They lose patience and bury it somewhere else. Both come back for it.", sceneType: "diagram", emotionalRegister: "amused", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "The Atlantic is in two layers today. The kelp is on top, dark and slick. The wind is in the middle, shaking it.", sceneType: "establishing", emotionalRegister: "weathered", cameraAngle: "wide" },
      { pageNum: 4, textExcerpt: "Signal Hill turns into a grey silk sheet in five minutes. The headlights start coming on, slowly, like thoughts.", sceneType: "establishing", emotionalRegister: "contemplative", cameraAngle: "wide" },
      { pageNum: 5, textExcerpt: "The rain stops at four. The city shines for ninety seconds before the early dark settles.", sceneType: "establishing", emotionalRegister: "satisfied", cameraAngle: "wide" }
    ]
  },
  // ORIGINALS — flagship hooks
  {
    slug: "the-third-floor",
    title: "The Third Floor",
    author: "AnimBook Originals",
    synopsis:
      "An original micro-thriller AnimBook. Six floors, six scenes. The narrator is in the lift, but the lift does not always agree.",
    vertical: "ORIGINALS",
    genreTags: ["Thrills", "Micro fiction"],
    moodTags: ["suspenseful", "kinetic"],
    coverColor: "C49A1C",
    pages: [
      { pageNum: 1, textExcerpt: "Floor one. The lift doors open. The lobby is empty. The same receptionist is behind the desk. She never looks up.", sceneType: "establishing", emotionalRegister: "suspenseful", cameraAngle: "medium" },
      { pageNum: 2, textExcerpt: "Floor two. The lift stops on its own. The doors open onto a corridor that has been carpeted twice. Neither carpet is now there.", sceneType: "diagram", emotionalRegister: "suspenseful", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Floor three. The third floor. The lift does not respond to the button. The button is gone.", sceneType: "diagram", emotionalRegister: "suspenseful", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "Floor four. A man gets in. He presses one. He does not speak. He has been in this lift before.", sceneType: "diagram", emotionalRegister: "suspenseful", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "Floor five. The man is gone. The doors open onto a corridor that is on fire. The fire is silent. The carpet is the third carpet.", sceneType: "diagram", emotionalRegister: "suspenseful", cameraAngle: "wide" },
      { pageNum: 6, textExcerpt: "Floor one. The lift doors open. The lobby is empty. The same receptionist is behind the desk. She looks up, finally. ‘Where did you go?’ she asks.", sceneType: "establishing", emotionalRegister: "resolved", cameraAngle: "medium" }
    ]
  },
  // CONSUMER — another flagship-origin story
  {
    slug: "the-last-bus-to-jinja",
    title: "The Last Bus to Jinja",
    author: "AnimBook Originals",
    synopsis:
      "The last bus leaves at six. There are seven seats left. There are eleven people waiting at the stage. The conductor knows all of them by name.",
    vertical: "CONSUMER",
    genreTags: ["Human Stories", "Thrills"],
    moodTags: ["warm", "restless"],
    coverColor: "1B6B8A",
    pages: [
      { pageNum: 1, textExcerpt: "Six o'clock. The conductor counts the heads at the stage. Eleven. He counts the seats. He does not say seven.", sceneType: "establishing", emotionalRegister: "restless", cameraAngle: "wide" },
      { pageNum: 2, textExcerpt: "‘Ama,’ he calls. She is pregnant. He holds the door. She smiles at him, embarrassed, and folds herself in.", sceneType: "diagram", emotionalRegister: "warm", cameraAngle: "close" },
      { pageNum: 3, textExcerpt: "‘Tunde, my brother.’ The conductor sends him to the last row. ‘Your father rode with me to Jinja the day you were born.’", sceneType: "diagram", emotionalRegister: "tender", cameraAngle: "medium" },
      { pageNum: 4, textExcerpt: "Six seats. Six names. Five seats. He looks at the two men at the back. ‘You will come back tomorrow,’ he says. ‘I will save you a place.’", sceneType: "diagram", emotionalRegister: "satisfied", cameraAngle: "medium" },
      { pageNum: 5, textExcerpt: "The bus leaves at six ten. The two men at the back sit on a bench by the stage. They have a quarter-hour chat about last week’s match.", sceneType: "establishing", emotionalRegister: "contemplative", cameraAngle: "wide" }
    ]
  },
  // FAITH/SPIRIT — second devotional-style AnimBook
  {
    slug: "vespers-at-the-window",
    title: "Vespers at the Window",
    author: "AnimBook Originals",
    synopsis:
      "An AnimBook of original evening devotions. Five scenes, soft narration, theological advisor reviewed.",
    vertical: "FAITH",
    genreTags: ["Devotion", "Evening"],
    moodTags: ["contemplative", "sacred"],
    ageRating: "All ages",
    coverColor: "6B2D8B",
    pages: [
      { pageNum: 1, textExcerpt: "The window is the smallest chapel I know. The candle is the smallest liturgy. The dark is the smallest cathedral.", sceneType: "establishing", emotionalRegister: "sacred", cameraAngle: "close" },
      { pageNum: 2, textExcerpt: "I count three sounds before I sleep. The clock, the streetlight, the neighbour’s dog. None of them are mine.", sceneType: "diagram", emotionalRegister: "contemplative", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "The candle goes down by a centimetre an hour. I am asleep by the third centimetre.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "close" },
      { pageNum: 4, textExcerpt: "The first light comes back at five. The candle is not yet out. The flame leans toward it, the way flames do.", sceneType: "establishing", emotionalRegister: "hopeful", cameraAngle: "close" }
    ]
  },
  // WELLNESS — gentle movement
  {
    slug: "morning-pages",
    title: "Morning Pages",
    author: "AnimBook Originals",
    synopsis:
      "Three pages of writing. Three cups of water. One slow walk. A DREAM-tier AnimBook for the first thirty minutes of the day.",
    vertical: "WELLNESS",
    genreTags: ["Mindfulness", "Morning routine"],
    moodTags: ["calm", "fresh"],
    ageRating: "All ages",
    coverColor: "3F8172",
    pages: [
      { pageNum: 1, textExcerpt: "First: the pages. Three of them, longhand. Not for anyone. Just for the hand that holds the pen.", sceneType: "diagram", emotionalRegister: "calm", cameraAngle: "close" },
      { pageNum: 2, textExcerpt: "Second: the water. Three cups. The first is for waking. The second is for the body's slow chemistry. The third is for the second hour.", sceneType: "diagram", emotionalRegister: "fresh", cameraAngle: "medium" },
      { pageNum: 3, textExcerpt: "Third: the walk. Twenty minutes. No phone. No music. The road is the road.", sceneType: "establishing", emotionalRegister: "fresh", cameraAngle: "wide" },
      { pageNum: 4, textExcerpt: "By the time the kettle boils the day has begun, gently. Nothing urgent was on fire. Nothing urgent needed to be.", sceneType: "establishing", emotionalRegister: "satisfied", cameraAngle: "wide" }
    ]
  }
];

const TRANSLATIONS: Array<{ slug: string; fromLang: string; toLang: string; entries: Array<{ word: string; translation: string; pronunciation?: string; exampleSentence?: string }> }> = [
  {
    slug: "the-night-train",
    fromLang: "en",
    toLang: "sw",
    entries: [
      { word: "lagoon", translation: "bwawa", pronunciation: "bwah-wah", exampleSentence: "Bwawa linameta wakati wa jioni." },
      { word: "carriage", translation: "gari", pronunciation: "gah-ree" },
      { word: "moon", translation: "mwezi", pronunciation: "mweh-zee", exampleSentence: "Mwezi ulikuwa juu ya mlima." },
      { word: "stranger", translation: "mgeni", pronunciation: "mgeh-nee" },
      { word: "sleep", translation: "usingizi", pronunciation: "oo-seen-gee-zee" }
    ]
  },
  {
    slug: "the-night-train",
    fromLang: "en",
    toLang: "fr",
    entries: [
      { word: "lagoon", translation: "lagune", pronunciation: "lah-goon" },
      { word: "carriage", translation: "voiture", pronunciation: "vwah-toor" },
      { word: "moon", translation: "lune", pronunciation: "loon" },
      { word: "stranger", translation: "étranger", pronunciation: "ay-trahn-zhay" },
      { word: "sleep", translation: "sommeil", pronunciation: "so-mey" }
    ]
  },
  {
    slug: "the-tale-of-peter-rabbit",
    fromLang: "en",
    toLang: "es",
    entries: [
      { word: "garden", translation: "jardín", pronunciation: "har-deen" },
      { word: "mother", translation: "madre", pronunciation: "mah-dreh" },
      { word: "cottage", translation: "casita", pronunciation: "kah-see-tah" },
      { word: "fox", translation: "zorro", pronunciation: "soh-roh" },
      { word: "bread", translation: "pan", pronunciation: "pahn" }
    ]
  }
];

const PLACEHOLDER = (vertical: string, slug: string) =>
  `https://placehold.co/600x900/0D1B2E/${verticalToColor(vertical)}/png?text=${encodeURIComponent(slug.replace(/-/g, " "))}`;

function verticalToColor(vertical: string): string {
  const v: Record<string, string> = {
    CONSUMER: "1B6B8A",
    KIDS: "D9872A",
    EDU: "1A6B3C",
    FAITH: "6B2D8B",
    DOCS: "56738A",
    VERSE: "9D4C73",
    COMICS: "C94B32",
    BUSINESS: "B58B27",
    WELLNESS: "3F8172",
    LAW: "7A6650",
    TRAVEL: "14818E",
    ORIGINALS: "C49A1C"
  };
  return v[vertical] ?? "C49A1C";
}

async function upsertBook(input: SeedBook) {
  const exists = await prisma.book.findUnique({ where: { slug: input.slug } });
  if (exists) {
    console.log(`[phase11-seed]   exists: ${input.slug}`);
    return exists;
  }
  const book = await prisma.book.create({
    data: {
      slug: input.slug,
      title: input.title,
      author: input.author,
      synopsis: input.synopsis,
      vertical: input.vertical,
      status: "PUBLISHED",
      genreTags: input.genreTags,
      moodTags: input.moodTags,
      ageRating: input.ageRating ?? null,
      language: input.language ?? "en",
      narrationLanguages: input.narrationLanguages ?? ["en"],
      coverUrl: PLACEHOLDER(input.vertical, input.slug),
      requiresExpertReview: input.vertical === "FAITH",
      expertReviewStatus: input.vertical === "FAITH" ? "APPROVED" : "NOT_REQUIRED",
      totalPages: input.pages.length
    }
  });
  for (const p of input.pages) {
    await prisma.page.create({
      data: {
        bookId: book.id,
        pageNum: p.pageNum,
        textExcerpt: p.textExcerpt,
        sourceTextSha256: `phase11:${input.slug}:${p.pageNum}`,
        sceneType: p.sceneType,
        emotionalRegister: p.emotionalRegister,
        cameraAngle: p.cameraAngle,
        status: "APPROVED"
      }
    });
  }
  return book;
}

async function seedTranslations() {
  for (const pack of TRANSLATIONS) {
    const book = await prisma.book.findUnique({ where: { slug: pack.slug }, select: { id: true } });
    if (!book) continue;
    for (const entry of pack.entries) {
      await prisma.translationGloss.upsert({
        where: {
          sourceLang_targetLang_word: {
            sourceLang: pack.fromLang,
            targetLang: pack.toLang,
            word: entry.word
          }
        },
        update: { bookId: book.id, exampleSentence: entry.exampleSentence ?? null, pronunciation: entry.pronunciation ?? null, translation: entry.translation },
        create: {
          sourceLang: pack.fromLang,
          targetLang: pack.toLang,
          word: entry.word,
          translation: entry.translation,
          pronunciation: entry.pronunciation ?? null,
          exampleSentence: entry.exampleSentence ?? null,
          bookId: book.id
        }
      });
    }
    console.log(`[phase11-seed] translations: ${pack.slug} (${pack.fromLang}→${pack.toLang}, ${pack.entries.length} words)`);
  }
}

async function main() {
  console.log(`[phase11-seed] seeding ${BOOKS.length} new AnimBooks`);
  for (const book of BOOKS) {
    const created = await upsertBook(book);
    console.log(`[phase11-seed]   ${created.vertical.padEnd(10)} ${created.slug}`);
  }
  console.log(`[phase11-seed] seeding ${TRANSLATIONS.length} translation packs`);
  await seedTranslations();

  const totalCount = await prisma.book.count({ where: { status: "PUBLISHED" } });
  console.log(`[phase11-seed] total published AnimBooks: ${totalCount}`);
}

main()
  .catch((err) => {
    console.error("[phase11-seed] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
