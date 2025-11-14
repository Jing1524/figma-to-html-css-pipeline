import fs from "node:fs/promises";
import path from "node:path";
import { exportNodeSvgs } from "@/app/lib/figmaClient";
import { ClassifiedNode } from "@/app/lib/classifyNode";
import { safeId } from "./utils/render";

export async function emitSvgAssets(params: {
  fileKey: string;
  frames: ClassifiedNode[];
  publicDir: string; // public/generated/<fileKey>/assets
  fileLastModified?: string;
}) {
  const { fileKey, frames, publicDir, fileLastModified } = params;
  const ids = collectSvgNodeIds(frames);
  if (ids.length === 0) return;

  const cacheMap = await exportNodeSvgs(fileKey, ids, {
    fileLastModified,
  });

  await fs.mkdir(publicDir, { recursive: true });

  const copiedSrc = new Set<string>();

  for (const id of ids) {
    const src = cacheMap[id];
    const dest = path.join(publicDir, `${safeId(id)}.svg`);

    if (!src) {
      // Placeholder SVG if export failed for this node
      const placeholder = makePlaceholderSvg(id);
      await fs.writeFile(dest, placeholder, "utf8");
      continue;
    }

    if (!copiedSrc.has(src)) {
      await fs.copyFile(src, dest);
      copiedSrc.add(src);
    } else {
      await fs.copyFile(src, dest);
    }
  }
}

function collectSvgNodeIds(nodes: ClassifiedNode[]): string[] {
  const ids = new Set<string>();

  const traverse = (n: ClassifiedNode) => {
    if (n.renderAs === "svg") ids.add(n.id);
    n.children.forEach(traverse);
  };

  nodes.forEach(traverse);
  return Array.from(ids).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function makePlaceholderSvg(nodeId: string): string {
  const label = safeId(nodeId);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Missing SVG ${label}">`,
    `<rect x="0.5" y="0.5" width="15" height="15" rx="2" ry="2" fill="none" stroke="#ccc" stroke-width="1"/>`,
    `<line x1="3" y1="3" x2="13" y2="13" stroke="#ccc" stroke-width="1"/>`,
    `<line x1="13" y1="3" x2="3" y2="13" stroke="#ccc" stroke-width="1"/>`,
    `</svg>`,
  ].join("");
}
