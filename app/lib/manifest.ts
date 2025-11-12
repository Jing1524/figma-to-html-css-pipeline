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
  const manifest = {
    meta: {
      fileKey: params.fileKey,
      name: params.meta.name,
      lastModified: params.meta.lastModified,
      rendererVersion: "1.0.0",
    },
    counts: summarize(params.frames),
    warnings: params.warnings,
    nodes: flatten(params.frames).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      renderAs: (n as any).renderAs as RenderAs,
    })),
  };

  const dir = path.join(process.cwd(), "public", "generated", params.fileKey);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "nodes.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

function summarize(nodes: ClassifiedNode[]) {
  const all = flatten(nodes);
  return {
    total: all.length,
    html: all.filter((n) => (n as any).renderAs === "html").length,
    htmlText: all.filter((n) => (n as any).renderAs === "html-text").length,
    svg: all.filter((n) => (n as any).renderAs === "svg").length,
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
