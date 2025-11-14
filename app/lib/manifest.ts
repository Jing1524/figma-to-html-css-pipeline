"use server";
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { ClassifiedNode, RenderAs } from "@/app/lib/classifyNode";

export async function emitManifest(params: {
  fileKey: string;
  meta: { name: string; lastModified: string };
  frames: ClassifiedNode[];
  warnings: string[];
}) {
  const { fileKey, meta, frames, warnings } = params;

  const allNodes = flatten(frames);
  const counts = summarize(allNodes);

  const manifest = {
    meta: {
      fileKey,
      name: meta.name,
      lastModified: meta.lastModified,
      rendererVersion: "1.0.0",
    },
    counts,
    warnings,
    nodes: allNodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      renderAs: n.renderAs as RenderAs,
      childCount: n.children.length,
      // Useful to see when a whole subtree has been flattened into one SVG asset
      collapsedToSvg: n.renderAs === "svg" && n.children.length > 0,
    })),
  };

  const dir = path.join(process.cwd(), "public", "generated", fileKey);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "nodes.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

function summarize(nodes: ClassifiedNode[]) {
  return {
    total: nodes.length,
    html: nodes.filter((n) => n.renderAs === "html").length,
    htmlText: nodes.filter((n) => n.renderAs === "html-text").length,
    svg: nodes.filter((n) => n.renderAs === "svg").length,
  };
}

function flatten(nodes: ClassifiedNode[]): ClassifiedNode[] {
  const out: ClassifiedNode[] = [];
  const walk = (n: ClassifiedNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
