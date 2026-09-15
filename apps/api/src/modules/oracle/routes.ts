import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { generateOracleContinuation, getOrCreateOracleTree, persistOracleContinuation } from "../../services/oracle.js";

const router = Router();
router.use(authMiddleware);

router.get("/:bookId/decision/:rootPage", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  const rootPageRaw = req.params["rootPage"];
  if (typeof bookId !== "string" || typeof rootPageRaw !== "string") {
    res.status(400).json({ error: "Missing book id or root page" });
    return;
  }
  const rootPage = Number.parseInt(rootPageRaw, 10);
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const tree = await getOrCreateOracleTree(book.id, rootPage);
  res.json({
    treeId: tree.id,
    rootPage,
    choices: tree.nodes.filter((node) => node.parentNodeId === null).map((node) => ({
      nodeId: node.id,
      label: node.choiceLabel,
      prompt: node.promptText
    }))
  });
});

const chooseSchema = z.object({
  parentNodeId: z.string().min(1),
  pageNum: z.number().int().min(1)
});

router.post("/:bookId/choose", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const parsed = chooseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid choice", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const parent = await prisma.oracleNode.findUnique({ where: { id: parsed.data.parentNodeId } });
  if (!parent) {
    res.status(404).json({ error: "Oracle node not found" });
    return;
  }
  const continuation = await generateOracleContinuation({
    bookId: book.id,
    parentNodeId: parent.id,
    bookTitle: book.title,
    vertical: book.vertical,
    voice: parent.speakerName ?? "narrator"
  });
  const persisted = await persistOracleContinuation({
    treeId: parent.treeId,
    parentNodeId: parent.id,
    continuation,
    pageNum: parsed.data.pageNum
  });
  await prisma.oracleNode.update({
    where: { id: parent.id },
    data: { generatedText: continuation.generatedText, animationPrompt: continuation.animationPrompt }
  });
  res.json({ nodeId: persisted.id, continuation });
});

export default router;