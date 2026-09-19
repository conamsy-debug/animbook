import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const project = await prisma.studioProject.findFirst({
  where: { bookId: "cmu5mod660003pb1553fnqaur" },
  select: { id: true, status: true, currentStage: true, ownerId: true },
});
console.log("project:", project);

const creator = project ? await prisma.user.findUnique({
  where: { id: project.ownerId },
  select: { id: true, narratorVoiceId: true, voiceStatus: true },
}) : null;
console.log("creator:", creator);

const pagesTotal = await prisma.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur" } });
const pagesWithAudio = await prisma.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur", audioUrl: { not: null } } });
const pagesNoAudio = await prisma.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur", audioUrl: null } });
console.log("pages total/with-audio/no-audio:", pagesTotal, pagesWithAudio, pagesNoAudio);

await prisma.$disconnect();