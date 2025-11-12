"use server";
import "server-only";
import path from "node:path";
import { ClassifiedNode } from "@/app/lib/classifyNode";
import { cssClass, escapeHtml, safeId } from "./utils/render";

export function buildIndexHtml(
  fileKey: string,
  frames: ClassifiedNode[]
): string {
  const body = frames.map(renderNode).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8"/>',
    '  <meta name="viewport" content="width=device-width,initial-scale=1"/>',
    `  <title>${escapeHtml(fileKey)} — Generated</title>`,
    '  <link rel="stylesheet" href="./styles.css"/>',
    "  <style>body{margin:0;position:relative;min-height:100vh;background:#fff}</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

function renderNode(node: ClassifiedNode): string {
  const cls = cssClass(node.id);

  if (node.renderAs === "html-text") {
    // Use <p> as default; can refine to <h*> via name heuristics later.
    const content = escapeHtml((node as any).name ?? "");
    return `<p class="${cls}">${content}</p>`;
  }

  if (node.renderAs === "svg") {
    // The actual <img src> will be filled during copying into assets
    const svgFile = `${safeId(node.id)}.svg`;
    return `<img class="${cls}" src="./assets/${svgFile}" alt="" />`;
  }

  // html
  const children = node.children.map(renderNode).join("");
  return `<div class="${cls}">${children}</div>`;
}
