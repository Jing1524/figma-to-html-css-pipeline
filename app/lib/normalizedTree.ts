"use server";
import "server-only";
import {
  NormalizedNode,
  NormalizationResult,
  LayoutModel,
  StyleModel,
  Fill,
  Stroke,
  Effect,
  Typography,
  RGBA,
  ColorStop,
} from "@/app/type/normalized";

type AnyNode = Record<string, unknown>;

type BoundingBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type ImageFill = Extract<Fill, { kind: "image" }>;
type ImageScaleMode = ImageFill["scaleMode"];

type;

export function normalizeFile(documentRoot: unknown): NormalizationResult {
  const warnings: string[] = [];
  const frames: NormalizedNode[] = [];

  // Figma file root: { document: { children: [ pages... ] } }
  const doc = documentRoot as AnyNode;
  const pages = getArray(doc?.children);

  const stats = {
    nodesTotal: 0,
    frames: 0,
    texts: 0,
    vectors: 0,
    images: 0,
    gradients: 0,
    masks: 0,
  };

  for (const page of pages) {
    const pageChildren = getArray(page.children);
    for (const child of pageChildren) {
      // Render top-level frames/sections/components; ignore guides, etc.
      if (!isRenderable(child)) continue;
      const n = toNormalized(child, warnings, stats);
      if (n) {
        frames.push(n);
      }
    }
  }

  return { frames, warnings, stats };
}

// --- helpers ---

function toNormalized(
  node: AnyNode,
  warnings: string[],
  stats: any
): NormalizedNode | null {
  stats.nodesTotal += 1;

  const id = String(node.id ?? "");
  const name = String(node.name ?? "");
  const type = mapType(String(node.type ?? ""));

  if (!type) return null;

  if (type === "text") stats.texts += 1;
  if (type === "vector") stats.vectors += 1;
  if (type === "image") stats.images += 1;
  if (type === "frame") stats.frames += 1;

  const layout = mapLayout(node);
  const style = mapStyle(node, warnings, stats);
  const children = getArray(node.children)
    .map((child) => toNormalized(child as AnyNode, warnings, stats))
    .filter(Boolean) as NormalizedNode[];

  return { id, name, type, layout, style, children };
}

function mapType(figmaType: string): NormalizedNode["type"] | null {
  switch (figmaType) {
    case "FRAME":
    case "GROUP":
    case "COMPONENT":
    case "INSTANCE":
    case "SECTION":
      return "frame";
    case "TEXT":
      return "text";
    case "VECTOR":
    case "LINE":
    case "ELLIPSE":
    case "REGULAR_POLYGON":
    case "STAR":
    case "BOOLEAN_OPERATION":
      return "vector";
    case "RECTANGLE": {
      // Rectangle can act as image if it has an IMAGE fill; otherwise frame/vector.
      return "frame";
    }
    default:
      return null;
  }
}

function mapLayout(node: AnyNode): LayoutModel {
  const boundingBox = node.absoluteBoundingBox as BoundingBox | undefined;
  const absolute = isAbsolute(node);
  if (absolute) {
    const x = toNum(boundingBox?.x);
    const y = toNum(boundingBox?.y);
    const width = toNum(boundingBox?.width);
    const height = toNum(boundingBox?.height);
    return { display: "absolute", x, y, width, height };
  }

  const layoutMode = String(node.layoutMode ?? "NONE"); // 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  const direction =
    layoutMode === "HORIZONTAL"
      ? "row"
      : layoutMode === "VERTICAL"
      ? "column"
      : undefined;

  const padding = {
    top: toNum(node.paddingTop),
    right: toNum(node.paddingRight),
    bottom: toNum(node.paddingBottom),
    left: toNum(node.paddingLeft),
  };

  const gap = toNum(node.itemSpacing);
  const align = mapAlign(
    node.primaryAxisAlignItems,
    node.counterAxisAlignItems,
    direction
  );
  const justify = mapJustify(node.primaryAxisAlignItems, direction);

  const width = toNum(boundingBox?.width);
  const height = toNum(boundingBox?.height);

  return {
    display: direction ? "flex" : "absolute", // default to absolute if no auto-layout
    direction,
    padding,
    gap,
    align,
    justify,
    width,
    height,
  };
}

function isAbsolute(node: AnyNode): boolean {
  // When layoutMode is NONE and constraints pin the node, we treat as absolute.
  const layoutMode = String(node.layoutMode ?? "NONE");
  if (layoutMode !== "NONE") return false;
  return true;
}

function mapAlign(
  primary: unknown,
  counter: unknown,
  direction?: "row" | "column"
): LayoutModel["align"] {
  // Figma: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  const c = String(counter ?? "");
  switch (c) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_BETWEEN":
      return "stretch";
    default:
      return undefined;
  }
}

function mapJustify(
  primary: unknown,
  direction?: "row" | "column"
): LayoutModel["justify"] {
  const p = String(primary ?? "");
  switch (p) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
}

function mapStyle(node: AnyNode, warnings: string[], stats: any): StyleModel {
  const fills = mapFills(getArray(node.fills), warnings, stats);
  const strokes = mapStrokes(getArray(node.strokes), warnings);
  const borderRadius = mapRadius(node);
  const effects = mapEffects(getArray(node.effects));
  const typography = node.type === "TEXT" ? mapTypography(node) : undefined;
  const opacity = toNum(node.opacity, 1);
  const blendMode = node.blendMode ? String(node.blendMode) : undefined;
  const hasMask = Boolean(node.isMask);

  if (fills.some((f) => f.kind.endsWith("Gradient"))) stats.gradients += 1;
  if (hasMask) stats.masks += 1;

  return {
    fills,
    strokes,
    borderRadius,
    effects,
    typography,
    opacity,
    blendMode,
    hasMask,
  };
}

function mapFills(fills: AnyNode[], warnings: string[], _stats: any): Fill[] {
  const out: Fill[] = [];
  for (const f of fills) {
    const type = String(f.type ?? "");
    const visible = f.visible ?? true;
    if (!visible) continue;

    if (type === "SOLID") {
      const opacity = typeof f.opacity === "number" ? f.opacity : undefined;
      out.push({ kind: "solid", color: mapColor(f.color, opacity) });
    } else if (type === "GRADIENT_LINEAR") {
      out.push({
        kind: "linearGradient",
        stops: mapStops(f.gradientStops),
        angle: mapGradientAngle(f),
      });
    } else if (type === "GRADIENT_RADIAL") {
      out.push({ kind: "radialGradient", stops: mapStops(f.gradientStops) });
    } else if (type === "GRADIENT_ANGULAR" || type === "GRADIENT_CONIC") {
      out.push({
        kind: "conicGradient",
        stops: mapStops(f.gradientStops),
        angle: mapGradientAngle(f),
      });
    } else if (type === "IMAGE") {
      const imageRef = String(f.imageRef ?? "");
      const mode = f.scaleMode;
      const scaleMode: ImageScaleMode =
        mode === "FIT" || mode === "TILE" || mode === "CROP" ? mode : "FILL";
      out.push({ kind: "image", imageRef, scaleMode });
    } else {
      warnings.push(`Unsupported fill type: ${type}`);
    }
  }
  return out;
}

function mapStrokes(strokes: AnyNode[], warnings: string[]): Stroke[] {
  const out: Stroke[] = [];
  for (const s of strokes) {
    const visible = s.visible ?? true;
    if (!visible) continue;

    const width = toNum(s.weight ?? s.strokeWeight ?? s.width, 1);
    const alignment = String(s.alignment ?? "CENTER") as Stroke["alignment"];

    if (s.type === "SOLID") {
      const opacity = typeof s.opacity === "number" ? s.opacity : undefined;
      out.push({ alignment, width, color: mapColor(s.color, opacity) });
    } else if (String(s.type ?? "").startsWith("GRADIENT")) {
      out.push({
        alignment,
        width,
        gradient: {
          stops: mapStops(s.gradientStops),
          angle: mapGradientAngle(s),
        },
      });
    } else {
      warnings.push(`Unsupported stroke type: ${String(s.type ?? "")}`);
    }
  }
  return out;
}

function mapEffects(effects: AnyNode[]): Effect[] {
  const out: Effect[] = [];
  for (const effect of effects) {
    const type = String(effect.type ?? "");
    const offset = (effect as { offset?: { x?: number; y?: number } }).offset;
    const radius = (effect as { radius?: number }).radius;
    const spread = (effect as { spread?: number }).spread;
    const color = effect as { color?: unknown; opacity?: number };
    if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
      out.push({
        type,
        x: toNum(offset?.x),
        y: toNum(offset?.y),
        blur: toNum(radius),
        spread: toNum(spread),
        color: mapColor(color.color, color.opacity),
      });
    } else if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
      out.push({ type, blur: toNum(radius) });
    }
  }
  return out;
}

function mapTypography(node: AnyNode): Typography {
  const s = node.style ?? {};
  return {
    fontFamily: String((s as any).fontFamily ?? "system-ui"),
    fontPostScriptName: (s as any).fontPostScriptName ?? undefined,
    fontStyle: (s as any).fontStyle ?? undefined,
    fontWeight: toNum((s as any).fontWeight),
    fontSize: toNum((s as any).fontSize, 14),
    lineHeightPx: toNum((s as any).lineHeightPx),
    letterSpacing: toNum((s as any).letterSpacing),
    textCase: (s as any).textCase ?? "ORIGINAL",
    textDecoration: (s as any).textDecoration ?? "NONE",
    textAlignHorizontal: (s as any).textAlignHorizontal ?? "LEFT",
  };
}

function mapRadius(node: AnyNode) {
  // Uniform radius
  const uniform = (node as { cornerRadius?: number }).cornerRadius;
  if (typeof uniform === "number" && Number.isFinite(uniform)) return uniform;

  // Per-corner radii (exists only when corners are mixed)
  const r = (
    node as { rectangleCornerRadii?: [number?, number?, number?, number?] }
  ).rectangleCornerRadii;
  const [tlRaw, trRaw, brRaw, blRaw] = Array.isArray(r) ? r : [];

  const topLeft = toNum(tlRaw);
  const topRight = toNum(trRaw);
  const bottomRight = toNum(brRaw);
  const bottomLeft = toNum(blRaw);

  if ([topLeft, topRight, bottomRight, bottomLeft].some((v) => v)) {
    return { topLeft, topRight, bottomRight, bottomLeft };
  }
  return undefined;
}

// --- small utils ---

function getArray(input: unknown): AnyNode[] {
  return Array.isArray(input) ? (input as AnyNode[]) : [];
}

function toNum(input: unknown, fallback = 0): number {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function mapColor(color: any, opacity?: number): RGBA {
  const r = toNum(color?.r, 0);
  const g = toNum(color?.g, 0);
  const b = toNum(color?.b, 0);
  // Figma colors are 0..1; convert to 0..255 in CSS mapping later if needed.
  const a = typeof opacity === "number" ? opacity : toNum(color?.a, 1);
  return { r, g, b, a };
}

function mapStops(stops: unknown): ColorStop[] {
  return (Array.isArray(stops) ? stops : []).map((s) => ({
    position: toNum(s?.position, 0),
    color: mapColor(s?.color, s?.opacity),
  }));
}

function mapGradientAngle(n: AnyNode): number {
  // Figma gradients have "gradientTransform" matrix; for MVP keep angle=0,
  // TODO: handle exact angles later. This keeps logic simple now.
  const angle = 0;
  return angle;
}

function isRenderable(node: AnyNode): boolean {
  const type = String(node.type ?? "");
  if (type === "SLICE" || type === "GUIDE") return false;
  return true;
}
