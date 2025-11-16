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
    return renderTextElement(node, cls);
  }

  if (node.renderAs === "svg") {
    // The actual <img src> will be filled from generated assets/
    const svgFile = `${safeId(node.id)}.svg`;
    return `<img class="${cls}" src="./assets/${svgFile}" alt="" />`;
  }

  // html container node
  const children = node.children.map(renderNode).join("");
  return `<div class="${cls}">${children}</div>`;
}

/**
 * Render a text node. Supports:
 * - simple text (node.text)
 * - mixed-style spans (node.spans)
 * - line breaks via <br/>
 */
function renderTextElement(node: ClassifiedNode, baseClass: string): string {
  // Prefer spans if present; fall back to raw text
  const spans = node.spans;
  let innerHtml: string;

  if (Array.isArray(spans) && spans.length > 0) {
    innerHtml = spans
      .map((span, index) => {
        const spanClass = `${baseClass}__span-${index}`;
        const rawText = span.text ?? "";
        const escaped = escapeHtml(rawText).replace(/\n/g, "<br/>");
        return `<span class="${spanClass}">${escaped}</span>`;
      })
      .join("");
  } else {
    const rawText = node.text ?? "";
    const escaped = escapeHtml(rawText).replace(/\n/g, "<br/>");
    innerHtml = escaped;
  }

  return `<p class="${baseClass}">${innerHtml}</p>`;
}
