import { NormalizedNode, Fill, Stroke } from "@/app/type/normalized";

export type RenderAs = "html" | "html-text" | "svg";

/**
 * Classify a single normalized node into an output render strategy.
 * Rules (capability-based, deterministic):
 * - TEXT → 'html-text'
 * - If node uses masks, multiple strokes, any non-solid fill, or non-NORMAL blend → 'svg'
 * - Otherwise → 'html'
 */
export function classifyNode(node: NormalizedNode): RenderAs {
  // 1) Text is always rendered as real text for accessibility & selection
  if (node.type === "text") return "html-text";

  const { fills, strokes, blendMode, hasMask } = node.style ?? {};

  // 2) Capability boundaries → SVG fallback
  if (hasMask) return "svg";
  if (needsSvgForStrokes(strokes)) return "svg";
  if (hasNonSolidFill(fills)) return "svg";
  if (hasNonNormalBlend(blendMode)) return "svg";

  // 3) Default: safe to render with HTML/CSS
  return "html";
}

// ---- helpers ----

function needsSvgForStrokes(strokes?: Stroke[]): boolean {
  if (!strokes || strokes.length === 0) return false;

  // Multiple strokes → SVG (CSS cannot stack them faithfully)
  if (strokes.length > 1) return true;

  const s = strokes[0];

  // Gradient stroke → SVG
  if (s.kind !== "solid") return true;

  // Stroke alignment: only CENTER is safe for CSS borders
  if (s.alignment !== "CENTER") return true;

  // Custom dash pattern → SVG
  // TODO: the dashed line is more nuanced; CSS can do simple dashes, but not complex patterns
  // if (Array.isArray(s.dashPattern) && s.dashPattern.length > 0) return true;
  if (s.dashed) return true;

  // Otherwise, CSS can handle this stroke
  return false;
}

function hasNonSolidFill(fills?: Fill[]): boolean {
  if (!fills || fills.length === 0) return false;
  return fills.some((f) => f.kind !== "solid" && f.kind !== "image"); //allow image fills
}

function hasNonNormalBlend(blendMode?: string): boolean {
  if (!blendMode) return false;
  return blendMode !== "NORMAL";
}

export type ClassifiedNode = Omit<NormalizedNode, "children"> & {
  renderAs: RenderAs;
  children: ClassifiedNode[]; //recursive
};

export function classifyTree(root: NormalizedNode): ClassifiedNode {
  const renderAs = classifyNode(root);
  const children = root.children.map(classifyTree);
  return { ...root, renderAs, children };
}
