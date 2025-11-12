"use server";
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { ClassifiedNode } from "@/app/lib/classifyNode";
import { Fill, ImageFillInfo } from "@/app/type/normalized";
import { safeId } from "./utils/render";

const FIGMA_API = "https://api.figma.com/v1";

type ExportBitmapOpts = {
  scale?: number;
  format?: "png" | "jpg"; // PNG as default/safe
  useCache?: boolean;
};

export type ImageAssetMap = Record<
  string, // nodeId
  {
    fileName: string;
    relativePath: string;
    scaleMode: ImageFillInfo["scaleMode"];
  }
>;

/**
 * High-level: find IMAGE-fill nodes, export bitmaps, and copy them into the
 * public assets directory. Returns an imageAssetMap the CSS layer can use.
 */
export async function prepareImageAssets(params: {
  fileKey: string;
  frames: ClassifiedNode[];
  publicAssetsDir: string;
  figmaToken: string;
  scale?: number;
  format?: "png" | "jpg";
  useCache?: boolean; // default true
}): Promise<ImageAssetMap> {
  const {
    fileKey,
    frames,
    publicAssetsDir,
    figmaToken,
    scale = 2,
    format = "png",
    useCache = true,
  } = params;

  const imageNodes = collectImageFillNodes(frames);
  if (imageNodes.length === 0) return {};

  // 1) Export from Figma (to .cache)
  const cacheMap = await exportNodeBitmaps(
    fileKey,
    imageNodes.map((n) => n.nodeId),
    {
      scale,
      format,
      useCache,
      figmaToken,
    }
  );

  // 2) Mirror into /public/generated/<fileKey>/assets
  await fs.mkdir(publicAssetsDir, { recursive: true });

  const out: ImageAssetMap = {};
  for (const info of imageNodes) {
    const cached = cacheMap[info.nodeId];
    if (!cached) continue; // could not export (rare)

    const basename = `${safeId(info.nodeId)}@${scale}x.${format}`;
    const dest = path.join(publicAssetsDir, basename);
    await fs.copyFile(cached, dest);

    out[info.nodeId] = {
      fileName: basename,
      relativePath: `./assets/${basename}`,
      scaleMode: info.scaleMode,
    };
  }

  return out;
}

/**
 * Walk the classified tree and collect nodes that:
 *  - will be rendered as HTML (not full-SVG),
 *  - have at least one IMAGE fill.
 */
function collectImageFillNodes(frames: ClassifiedNode[]): ImageFillInfo[] {
  const list: ImageFillInfo[] = [];

  const traverse = (n: ClassifiedNode) => {
    //only attach CSS background images to elements that are rendering as HTML.
    if (n.renderAs === "html" && Array.isArray(n.style?.fills)) {
      const imgFill = n.style.fills.find((f: Fill) => f.kind === "image") as
        | Extract<Fill, { kind: "image" }>
        | undefined;
      if (imgFill && imgFill.imageRef) {
        list.push({ nodeId: n.id, scaleMode: imgFill.scaleMode });
      }
    }
    n.children.forEach(traverse);
  };

  frames.forEach(traverse);
  return list;
}

/**
 * Export node bitmaps via Figma "images" endpoint (format=png/jpg).
 * Caches into ".cache/figma/bitmaps/<fileKey>/<nodeId>@{scale}x.{ext}"
 */
async function exportNodeBitmaps(
  fileKey: string,
  nodeIds: string[],
  options: ExportBitmapOpts & { figmaToken: string }
): Promise<Record<string, string>> {
  const { scale = 2, format = "png", useCache = true, figmaToken } = options;

  const cacheRoot = path.join(
    process.cwd(),
    ".cache",
    "figma",
    "bitmaps",
    fileKey
  );
  await fs.mkdir(cacheRoot, { recursive: true });

  // Split into cached vs missing
  const toFetch: string[] = [];
  const result: Record<string, string> = {};
  for (const id of nodeIds) {
    const destinationPath = path.join(
      cacheRoot,
      `${safeId(id)}@${scale}x.${format}`
    );
    if (useCache && (await exists(destinationPath))) {
      result[id] = destinationPath;
    } else {
      toFetch.push(id);
    }
  }
  if (toFetch.length === 0) return result;

  // Request signed image URLs from Figma
  const url = new URL(`${FIGMA_API}/images/${encodeURIComponent(fileKey)}`);
  url.searchParams.set("ids", toFetch.join(","));
  url.searchParams.set("format", format);
  url.searchParams.set("scale", String(scale));

  const res = await fetch(url.toString(), {
    headers: { "X-Figma-Token": figmaToken },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Figma /images failed (${res.status}): ${body}`);
  }

  const { images, err } = (await res.json()) as {
    images: Record<string, string | null>;
    err?: string | null;
  };
  if (err) throw new Error(`Figma /images error: ${err}`);

  // Download each bitmap and write to cache
  for (const id of toFetch) {
    const remote = images[id];
    if (!remote) continue;

    const imgRes = await fetch(remote, { cache: "no-store" });
    if (!imgRes.ok) continue;

    const arrayBuf = await imgRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const destinationPath = path.join(
      cacheRoot,
      `${safeId(id)}@${scale}x.${format}`
    );
    await fs.writeFile(destinationPath, buf);
    result[id] = destinationPath;
  }

  return result;
}

// --- small util---

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
