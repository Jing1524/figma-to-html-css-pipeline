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
  format?: "png" | "jpg"; // PNG as default
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

type BitmapCacheMeta = {
  lastModified: string | null;
};

function getRequiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function authHeaders(): HeadersInit {
  const token = getRequiredEnv("FIGMA_TOKEN");
  return {
    "X-Figma-Token": token,
  };
}

/**
 * High-level: find IMAGE-fill nodes, export bitmaps, and copy them into the
 * public assets directory. Returns an imageAssetMap the CSS layer can use.
 *
 * - Uses lastModified-aware cache for bitmaps per fileKey.
 */
export async function prepareImageAssets(params: {
  fileKey: string;
  frames: ClassifiedNode[];
  publicAssetsDir: string;
  scale?: number;
  format?: "png" | "jpg";
  useCache?: boolean; // default true
  fileLastModified?: string; // for invalidation
}): Promise<ImageAssetMap> {
  const {
    fileKey,
    frames,
    publicAssetsDir,
    scale = 2,
    format = "png",
    useCache = true,
    fileLastModified,
  } = params;

  const imageNodes = collectImageFillNodes(frames);
  if (imageNodes.length === 0) return {};

  const cacheRoot = path.join(
    process.cwd(),
    ".cache",
    "figma",
    "bitmaps",
    fileKey
  );

  // Invalidate bitmap cache if file has changed on Figma's side
  if (useCache && fileLastModified) {
    const meta = await readBitmapCacheMeta(cacheRoot);
    const cachedLastModified = meta?.lastModified ?? null;
    if (cachedLastModified && cachedLastModified !== fileLastModified) {
      try {
        await fs.rm(cacheRoot, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          `Failed to clear stale bitmap cache for fileKey=${fileKey}`,
          err
        );
      }
    }
  }

  await fs.mkdir(cacheRoot, { recursive: true });

  // 1) Export from Figma (to .cache)
  const cacheMap = await exportNodeBitmaps(
    fileKey,
    imageNodes.map((n) => n.nodeId),
    {
      scale,
      format,
      useCache,
    },
    cacheRoot
  );

  // 2) Mirror into /public/generated/<fileKey>/assets
  await fs.mkdir(publicAssetsDir, { recursive: true });

  const out: ImageAssetMap = {};
  for (const info of imageNodes) {
    const cached = cacheMap[info.nodeId];
    if (!cached) continue; // export failed for this node

    const basename = `${safeId(info.nodeId)}@${scale}x.${format}`;
    const dest = path.join(publicAssetsDir, basename);
    await fs.copyFile(cached, dest);

    out[info.nodeId] = {
      fileName: basename,
      relativePath: `./assets/${basename}`,
      scaleMode: info.scaleMode,
    };
  }

  // Update bitmap cache metadata
  if (fileLastModified) {
    await writeBitmapCacheMeta(cacheRoot, { lastModified: fileLastModified });
  }

  return out;
}

/**
 * Walk the classified tree and collect nodes that:
 *  - will be rendered as HTML (not full-SVG),
 *  - have at least one IMAGE fill.
 *
 * Deduped by nodeId and sorted for deterministic output.
 */
function collectImageFillNodes(frames: ClassifiedNode[]): ImageFillInfo[] {
  const map = new Map<string, ImageFillInfo>();

  const traverse = (n: ClassifiedNode) => {
    // only attach CSS background images to elements that are rendering as HTML.
    if (n.renderAs === "html" && Array.isArray(n.style?.fills)) {
      const fills = n.style.fills as Fill[];
      const imgFills = fills.filter((f) => f.kind === "image") as Extract<
        Fill,
        { kind: "image" }
      >[];

      if (imgFills.length > 0) {
        const primary = imgFills[0]; // currently only support one image fill per node
        if (primary.imageRef) {
          if (!map.has(n.id)) {
            map.set(n.id, {
              nodeId: n.id,
              scaleMode: primary.scaleMode,
            });
          }
          // TODO: If there are multiple image fills, keep the first and log a warning here.
        }
      }
    }
    n.children.forEach(traverse);
  };

  frames.forEach(traverse);

  return Array.from(map.values()).sort((a, b) =>
    a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0
  );
}

/**
 * Export node bitmaps via Figma "images" endpoint (format=png/jpg).
 * Caches into ".cache/figma/bitmaps/<fileKey>/<safeId(nodeId)>@{scale}x.{ext}"
 */
async function exportNodeBitmaps(
  fileKey: string,
  nodeIds: string[],
  options: ExportBitmapOpts,
  cacheRoot: string
): Promise<Record<string, string>> {
  const { scale = 2, format = "png", useCache = true } = options;

  await fs.mkdir(cacheRoot, { recursive: true });

  // Dedup and sort nodeIds for deterministic behavior
  const uniqueSortedIds = Array.from(new Set(nodeIds)).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  // Split into cached vs missing
  const toFetch: string[] = [];
  const result: Record<string, string> = {};
  for (const id of uniqueSortedIds) {
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
    headers: authHeaders(),
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

// --- bitmap cache meta helpers ---

async function readBitmapCacheMeta(
  cacheRoot: string
): Promise<BitmapCacheMeta | null> {
  const metaPath = path.join(cacheRoot, "__meta.json");
  if (!(await exists(metaPath))) return null;
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw) as BitmapCacheMeta;
  } catch (err) {
    console.warn("Failed to read bitmap cache meta, ignoring cache", err);
    return null;
  }
}

async function writeBitmapCacheMeta(
  cacheRoot: string,
  meta: BitmapCacheMeta
): Promise<void> {
  await fs.mkdir(cacheRoot, { recursive: true });
  const metaPath = path.join(cacheRoot, "__meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta), "utf8");
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
