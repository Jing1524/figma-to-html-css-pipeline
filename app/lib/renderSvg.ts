import fs from "node:fs/promises";
import path from "node:path";
import { exportNodeSvgs } from "@/app/lib/figmaClient";
import { ClassifiedNode } from "@/app/lib/classifyNode";
import { safeId } from "./utils/render";

export async function emitSvgAssets(params: {
  fileKey: string;
  frames: ClassifiedNode[];
  publicDir: string; // public/generated/<fileKey>/assets
}) {
  const { fileKey, frames, publicDir } = params;
  const ids = collectSvgNodeIds(frames);
  if (ids.length === 0) return;

  const cacheMap = await exportNodeSvgs(fileKey, ids);
  await fs.mkdir(publicDir, { recursive: true });

  for (const id of ids) {
    const src = cacheMap[id];
    if (!src) continue;
    const dest = path.join(publicDir, `${safeId(id)}.svg`);
    await fs.copyFile(src, dest);
  }
  // TODO: render a tiny placeholder SVG to avoid broken images.
}

function collectSvgNodeIds(nodes: ClassifiedNode[]): string[] {
  const out: string[] = [];
  const traverse = (n: ClassifiedNode) => {
    if (n.renderAs === "svg") out.push(n.id);
    n.children.forEach(traverse);
  };
  nodes.forEach(traverse);
  return out;
}
