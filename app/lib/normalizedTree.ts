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
  ImageScaleMode,
} from "@/app/type/normalized";

type AnyNode = Record<string, unknown>;

type BoundingBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type NormalizationStats = {
  nodesTotal: number;
  frames: number;
  texts: number;
  vectors: number;
  images: number;
  gradients: number;
  masks: number;
};

export function normalizeFile(documentRoot: unknown): NormalizationResult {
  const warnings: string[] = [];
  const frames: NormalizedNode[] = [];

  //`documentRoot`=> Figma document node (file.document),
  // which has children = pages.
  const doc = documentRoot as AnyNode;
  const pages = getArray(doc?.children);

  const stats: NormalizationStats = {
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
      // Render top-level frames/sections/components; ignore guides, slices, etc.
      if (!isRenderable(child as AnyNode)) continue;
      const n = toNormalized(child as AnyNode, warnings, stats);
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
  stats: NormalizationStats
): NormalizedNode | null {
  stats.nodesTotal += 1;

  const id = String(node.id ?? "");
  const name = String(node.name ?? "");
  const type = mapType(node);

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

function mapType(node: AnyNode): NormalizedNode["type"] | null {
  const figmaType = String(node.type ?? "");

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
      // Rectangle can act as image if it has an IMAGE fill; otherwise treat as frame.
      const fills = getArray((node as { fills?: unknown }).fills);
      const hasImageFill = fills.some(
        (f) => String((f as AnyNode).type ?? "") === "IMAGE"
      );
      if (hasImageFill) {
        return "image";
      }
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
  // Simple heuristic: when layoutMode is NONE, treat the node as absolutely positioned.
  const layoutMode = String(node.layoutMode ?? "NONE");
  return layoutMode === "NONE";
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
      // This is a bit of a compromise; there's no perfect mapping for counter-axis SPACE_BETWEEN.
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

function mapStyle(
  node: AnyNode,
  warnings: string[],
  stats: NormalizationStats
): StyleModel {
  const fills = mapFills(getArray(node.fills), warnings, stats);
  const strokes = mapStrokes(getArray(node.strokes), warnings);
  const borderRadius = mapRadius(node);
  const effects = mapEffects(getArray(node.effects));
  const typography = node.type === "TEXT" ? mapTypography(node) : undefined;
  const opacity = toNum(node.opacity, 1);
  const blendMode = node.blendMode ? String(node.blendMode) : undefined;
  const hasMask = Boolean((node as { isMask?: boolean }).isMask);

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
    const visible = (f.visible as boolean | undefined) ?? true;
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
      const mode = (f as AnyNode).scaleMode;
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
    const visible = (s.visible as boolean | undefined) ?? true;
    if (!visible) continue;

    const width = toNum(
      (s as any).weight ?? (s as any).strokeWeight ?? (s as any).width,
      1
    );
    const alignment = String(
      (s as any).alignment ?? "CENTER"
    ) as Stroke["alignment"];

    if (s.type === "SOLID") {
      const opacity =
        typeof (s as any).opacity === "number" ? (s as any).opacity : undefined;
      out.push({
        kind: "solid",
        alignment,
        width,
        color: mapColor((s as any).color, opacity),
      });
    } else if (String(s.type ?? "").startsWith("GRADIENT")) {
      out.push({
        kind: "gradient",
        alignment,
        width,
        gradient: {
          stops: mapStops((s as any).gradientStops),
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
  const s = (node as { style?: AnyNode }).style ?? {};
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
  // Figma colors are 0..1
  const a = typeof opacity === "number" ? opacity : toNum(color?.a, 1);
  return { r, g, b, a };
}

function mapStops(stops: unknown): ColorStop[] {
  return (Array.isArray(stops) ? stops : []).map((s) => ({
    position: toNum((s as any)?.position, 0),
    color: mapColor((s as any)?.color, (s as any)?.opacity),
  }));
}

function mapGradientAngle(n: AnyNode): number {
  // Figma gradients have a 2x3 "gradientTransform" matrix:
  // [
  //   [a, c, tx],
  //   [b, d, ty],
  // ]
  //first column (a, b) is the direction vector.
  const transform = (n as any).gradientTransform as number[][] | undefined;
  if (!Array.isArray(transform) || transform.length < 2) {
    return 0;
  }

  const [row0, row1] = transform;
  if (
    !Array.isArray(row0) ||
    !Array.isArray(row1) ||
    row0.length < 2 ||
    row1.length < 2
  ) {
    return 0;
  }

  const a = row0[0]; // x of direction vector
  const b = row1[0]; // y of direction vector

  if (typeof a !== "number" || typeof b !== "number" || (!a && !b)) {
    return 0;
  }

  // Angle of the direction vector in radians
  const angleRad = Math.atan2(b, a);
  let angleDeg = (angleRad * 180) / Math.PI;

  // Normalize to [0, 360)
  if (angleDeg < 0) {
    angleDeg += 360;
  }

  // CSS linear-gradient(θdeg) uses 0deg = up, 90deg = right.
  // The vector angle we computed is relative to the x-axis (right).
  // A common mapping is:
  //   cssAngle = 90deg - vectorAngle
  let cssAngle = 90 - angleDeg;

  // Normalize again to keep it in [0, 360)
  cssAngle = ((cssAngle % 360) + 360) % 360;

  return cssAngle;
}

function isRenderable(node: AnyNode): boolean {
  const type = String(node.type ?? "");
  const visible = (node as { visible?: boolean }).visible;
  if (visible === false) return false;

  // Skip non-visual node types
  if (type === "SLICE" || type === "GUIDE" || type === "COMPONENT_SET") {
    return false;
  }
  return true;
}
