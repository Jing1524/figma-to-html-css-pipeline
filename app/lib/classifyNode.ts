import { NormalizedNode, Fill, Stroke, Effect } from "@/app/type/normalized";

export type RenderAs = "html" | "html-text" | "svg";

/**
 * Classify a single normalized node into how it should be rendered.
 * Rules:
 * - TEXT:
 *    - If fills/blend/effects/strokes are simple → 'html-text'
 *    - Otherwise → 'svg'
 * - Non-text:
 *    - If node uses masks, complex strokes, unsupported fills, unsafe blend, or complex effects → 'svg'
 *    - Otherwise → 'html'
 */
export function classifyNode(node: NormalizedNode): RenderAs {
  const { fills, strokes, blendMode, hasMask, effects } = node.style ?? {};

  if (node.type === "text") {
    // Text nodes: prefer HTML text when visuals are simple enough
    const needsSvg =
      hasMask ||
      needsSvgForStrokes(strokes) ||
      needsSvgForFills(fills) ||
      needsSvgForEffects(effects) ||
      hasUnsafeBlendMode(blendMode);

    return needsSvg ? "svg" : "html-text";
  }

  // Non-text nodes
  if (hasMask) return "svg";
  if (needsSvgForStrokes(strokes)) return "svg";
  if (needsSvgForFills(fills)) return "svg";
  if (needsSvgForEffects(effects)) return "svg";
  if (hasUnsafeBlendMode(blendMode)) return "svg";

  return "html";
}

// ---- helpers ----

/**
 * Strokes that HTML/CSS can’t reproduce faithfully:
 * - multiple strokes
 * - gradient strokes
 * - non-CENTER alignment
 * - custom dash patterns
 */
function needsSvgForStrokes(strokes?: Stroke[]): boolean {
  if (!strokes || strokes.length === 0) return false;

  // Multiple strokes
  if (strokes.length > 1) return true;

  const s = strokes[0];

  // Gradient stroke → SVG for now
  if (s.kind !== "solid") return true;

  // Stroke alignment: only CENTER maps to CSS border
  if (s.alignment !== "CENTER") return true;

  // Custom dash pattern → SVG (CSS can't do arbitrary dash arrays on borders)
  if (Array.isArray(s.dashPattern) && s.dashPattern.length > 0) return true;

  return false;
}

/**
 * Fills that require SVG:
 * - any unknown fill kind
 * Everything else (solid, image, linear/radial/conic) is allowed for HTML.
 */
function needsSvgForFills(fills?: Fill[]): boolean {
  if (!fills || fills.length === 0) return false;

  for (const f of fills) {
    switch (f.kind) {
      case "solid":
      case "image":
      case "linearGradient":
      case "radialGradient":
      case "conicGradient":
        continue;
      default:
        // Any unknown/custom kind → SVG for safety
        return true;
    }
  }

  return false;
}

/**
 * Blend modes:
 * - NORMAL and PASS_THROUGH are safe
 * - anything else → SVG
 */
function hasUnsafeBlendMode(blendMode?: string): boolean {
  if (!blendMode) return false;
  if (blendMode === "NORMAL" || blendMode === "PASS_THROUGH") return false;
  return true;
}

/**
 * Effects:
 * - Any blur (LAYER_BLUR or BACKGROUND_BLUR) → SVG
 * - Multiple shadows → SVG
 * - Single simple shadow → HTML
 */
function needsSvgForEffects(effects?: Effect[]): boolean {
  if (!effects || effects.length === 0) return false;

  let shadowCount = 0;
  let hasBlur = false;

  for (const e of effects) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      shadowCount += 1;
    } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
      hasBlur = true;
    }
  }

  if (hasBlur) return true;
  if (shadowCount > 1) return true;

  return false;
}

export type ClassifiedNode = Omit<NormalizedNode, "children"> & {
  renderAs: RenderAs;
  children: ClassifiedNode[];
};

export function classifyTree(root: NormalizedNode): ClassifiedNode {
  const renderAs = classifyNode(root);
  const children = root.children.map(classifyTree);
  return { ...root, renderAs, children };
}
