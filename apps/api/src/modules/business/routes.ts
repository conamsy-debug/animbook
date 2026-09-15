/**
 * BUSINESS vertical — SCORM export.
 *
 * Exports an AnimBook as a SCORM 2004 4th Edition ZIP. The real exporter
 * shells out to a Node-side zip library; this stub generates a
 * conformant imsmanifest.xml + a README so the team can hand off the export
 * to the LMS side while the binary asset bundling is finalised.
 *
 * Why a stub: SCORM packaging requires an LMS partner test pass. Until
 * that gate is signed off, the export returns a deterministic file set
 * keyed off the AnimBook's structure so the L&D team has a stable contract.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.get("/scorm/:bookSlug", async (req: AuthedRequest, res: Response) => {
  const slug = req.params["bookSlug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing book slug" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: slug }, { slug }] },
    include: { pages: { orderBy: { pageNum: "asc" } } }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const manifest = buildImsManifest(book);
  const readme = buildReadme(book);
  res.json({
    title: book.title,
    scormVersion: "2004 4th Edition",
    bookSlug: book.slug,
    assets: book.pages.map((p) => ({
      pageNum: p.pageNum,
      identifier: `animbook-page-${p.pageNum}`,
      videoUrl: p.videoUrl,
      audioUrl: p.audioUrl,
      vttUrl: p.vttUrl,
      posterUrl: p.posterUrl,
      textExcerpt: p.textExcerpt
    })),
    imsManifest: manifest,
    readme,
    note: "Replace the placeholder URL list with the bundled asset paths once the SCORM packager ships."
  });
});

function buildImsManifest(book: {
  title: string;
  slug: string;
  author: string;
  pages: { pageNum: number; textExcerpt: string }[];
}): string {
  const items = book.pages
    .map(
      (p) =>
        `    <item identifier="ITEM-PAGE-${p.pageNum}" identifierref="RES-PAGE-${p.pageNum}" isvisible="true">\n` +
        `      <title>Page ${p.pageNum}</title>\n` +
        `    </item>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="ANIMBOOK-${book.slug.toUpperCase()}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                       http://www.imsglobal.org/xsd/imsmd_v1p2 imsmd_v1p2p2.xsd
                       http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <imsmd:lom xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2">
      <imsmd:general>
        <imsmd:title><![CDATA[${book.title}]]></imsmd:title>
        <imsmd:creator><![CDATA[${book.author}]]></imsmd:creator>
      </imsmd:general>
    </imsmd:lom>
  </metadata>
  <organizations default="ORG-ANIMBOOK">
    <organization identifier="ORG-ANIMBOOK">
      <title>${book.title}</title>
${items}
    </organization>
  </organizations>
  <resources>
${book.pages
  .map(
    (p) =>
      `    <resource identifier="RES-PAGE-${p.pageNum}" type="webcontent" adlcp:scormtype="sco">` +
      `<file href="pages/page-${p.pageNum}.html" /></resource>`
  )
  .join("\n")}
  </resources>
</manifest>
`;
}

function buildReadme(book: { title: string; slug: string; totalPages: number }): string {
  return `# AnimBook SCORM package

Book: ${book.title}
Slug: ${book.slug}
Pages: ${book.totalPages}

This package conforms to SCORM 2004 4th Edition. To complete the export:

1. Download every AnimPage asset (video / audio / vtt / poster) into /pages/.
2. Run the SCORM packager against the imsmanifest.xml in this folder.
3. Upload the resulting .zip to your LMS.
`;
}

export default router;