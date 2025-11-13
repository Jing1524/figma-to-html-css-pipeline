import { NextResponse } from "next/server";
import { fetchFileJson } from "@/app/lib/figmaClient";
import { normalizeFile } from "@/app/lib/normalizedTree";
import { classifyTree } from "@/app/lib/classifyNode";
import path from "path";
import { prepareImageAssets } from "@/app/lib/imageMapper";
import { buildStyles } from "@/app/lib/renderCss";
import { buildIndexHtml } from "@/app/lib/reanderHTML";
import { emitSvgAssets } from "@/app/lib/renderSVG";
import { emitManifest } from "@/app/lib/manifest";
import { emitFiles } from "@/app/lib/emitFiles";

// Force Node.js runtime avoid edge caching: usage of fs in the client
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConvertRequest = {
  fileKey?: string;
  useCache?: boolean; // optional override (default true)
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConvertRequest;

    const fileKey = (body.fileKey || "").trim();
    if (!fileKey) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Missing "fileKey" in request body.',
          hint: "Provide only the file key from the Figma URL.",
        },
        { status: 400 }
      );
    }

    const useCache = body.useCache ?? true;

    // 1) Fetch file JSON (cached by lastModified inside figmaClient)
    const file = await fetchFileJson(fileKey, { useCache });

    // 2) Extract minimal meta
    const { name, lastModified, document } = file as {
      name: string;
      lastModified: string;
      document: unknown;
    };

    // 3) Quick stat: count nodes (shallow-safe)
    const stats = {
      nodeCount: countNodes(document),
    };

    // 4) Normalize the Figma document into intermediate model
    const normalized = normalizeFile(document);
    // 5) Classify each frame (html | html-text | svg)
    const classifiedFrames = normalized.frames.map((frame) =>
      classifyTree(frame)
    );

    // 6) Compute output dirs
    const outBaseDir = path.join(process.cwd(), "public", "generated", fileKey);
    const assetsDir = path.join(outBaseDir, "assets");

    // 7) Prepare IMAGE fill assets (bitmaps) into /assets
    const figmaToken = process.env.FIGMA_TOKEN;
    if (!figmaToken) {
      throw new Error(
        "FIGMA_TOKEN is not set. Add it to .env.local for image export."
      );
    }

    const imageAssets = await prepareImageAssets({
      fileKey,
      frames: classifiedFrames,
      publicAssetsDir: assetsDir,
      figmaToken,
      scale: 2,
      format: "png",
      useCache,
    });

    // 8) Build CSS and HTML
    const css = buildStyles(classifiedFrames, imageAssets);
    const html = buildIndexHtml(fileKey, classifiedFrames);
    console.log(`Built HTML and CSS for ${fileKey}`);
    console.log({ css });
    // 9) Emit index.html + styles.css
    const { outDir, assetsDir: finalAssetsDir } = await emitFiles({
      fileKey,
      html,
      css,
    });

    console.log(`Generated files for ${fileKey} in ${outDir}`);

    // 10) Emit SVG assets for nodes classified as svg
    await emitSvgAssets({
      fileKey,
      frames: classifiedFrames,
      publicDir: finalAssetsDir,
    });

    // 11) Emit manifest (nodes.json)
    await emitManifest({
      fileKey,
      meta: { name, lastModified },
      frames: classifiedFrames,
      warnings: normalized.warnings,
    });

    // 12) Respond with info on where to find the artifacts
    return NextResponse.json(
      {
        ok: true,
        meta: { fileKey, name, lastModified },
        stats,
        output: {
          url: `/generated/${fileKey}/index.html`,
          dir: `/generated/${fileKey}/`,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected error occurred.";

    //non-secret hints based on common Figma responses
    const hint =
      message.includes("404") || message.toLowerCase().includes("not found")
        ? "Check the fileKey and ensure your token user can access the file."
        : message.includes("401") || message.includes("403")
        ? "Verify FIGMA_TOKEN is set and has file_content:read scope (and file_metadata:read if use)."
        : message.includes("429")
        ? "Hit a rate limit. Try again in a minute; disk cache will reduce calls next time."
        : "See server logs for details.";

    return NextResponse.json(
      { ok: false, message, hint },
      { status: pickStatusCode(message) }
    );
  }
}

// --- helpers ---

function countNodes(root: unknown): number {
  // Figma "document" has a recursive "children" array on node-like objects.
  try {
    const seen = new Set<object>();
    function traverse(node: any): number {
      if (!node || typeof node !== "object" || seen.has(node)) return 0;
      seen.add(node);
      const children = Array.isArray(node.children) ? node.children : [];
      return (
        1 +
        children.reduce(
          (sum: number, child: Record<string, unknown>) =>
            sum + traverse(child),
          0
        )
      );
    }
    return traverse(root);
  } catch {
    return 0;
  }
}

function pickStatusCode(message: string): number {
  const m = message.toLowerCase();
  if (m.includes("404")) return 404;
  if (m.includes("401") || m.includes("403")) return 401;
  if (m.includes("429")) return 429;
  return 500;
}
