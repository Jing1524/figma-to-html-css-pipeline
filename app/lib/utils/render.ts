import {
  Effect,
  Fill,
  ImageFillInfo,
  Stroke,
  Typography,
  ColorStop,
  RGBA,
} from "@/app/type/normalized";
import { ClassifiedNode } from "../classifyNode";

export function traverse(
  node: ClassifiedNode,
  visit: (n: ClassifiedNode) => void
) {
  visit(node);
  node.children.forEach((c) => traverse(c as ClassifiedNode, visit));
}

// to keep css class valid and stable
export function cssClass(id: string) {
  return `n-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function px(n: number) {
  return `${Math.round(n * 1000) / 1000}px`;
}

// clamp range 0-1
export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function rgba(c: { r: number; g: number; b: number; a: number }) {
  // Figma uses 0..1 RGB; browsers use 0..255
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r},${g},${b},${clamp01(c.a)})`;
}

/**
 * Map Figma fills → CSS backgrounds.
 *
 * Supports:
 * - multiple fills
 * - solid colors
 * - linear gradients
 * - radial gradients
 * - conic gradients
 *
 * NOTE:
 * - Image fills are handled separately via imageAssets / cssForScaleMode.
 */
export function pushFill(rules: string[], fills: Fill[]) {
  if (!fills || fills.length === 0) return;

  // Ignore image fills here; they are handled by imageAssets mapping.
  const usable = fills.filter((f) => f.kind !== "image");
  if (usable.length === 0) return;

  const layers: string[] = [];

  // Figma paints: last is topmost. In CSS backgrounds, first is topmost.
  // So iterate from last → first and unshift each, or push in reverse.
  for (let i = usable.length - 1; i >= 0; i--) {
    const f = usable[i];
    switch (f.kind) {
      case "solid": {
        layers.push(rgba(f.color));
        break;
      }
      case "linearGradient": {
        const stops = gradientStopsToCss(f.stops);
        const angle = f.angle ?? 0;
        layers.push(`linear-gradient(${angle}deg, ${stops})`);
        break;
      }
      case "radialGradient": {
        const stops = gradientStopsToCss(f.stops);
        // intentionally not to match exact Figma radius/position; center circle is a good approximation for scope.
        layers.push(`radial-gradient(circle at center, ${stops})`);
        break;
      }
      case "conicGradient": {
        const stops = gradientStopsToCss(f.stops);
        const angle = f.angle ?? 0;
        layers.push(`conic-gradient(from ${angle}deg at 50% 50%, ${stops})`);
        break;
      }
      default:
        // Unknown fill kinds are ignored here; classifier already sent these to SVG rendering
        break;
    }
  }

  if (layers.length > 0) {
    rules.push(`background:${layers.join(",")};`);
  }
}

/**
 * Strokes → CSS borders / box-shadow.
 *
 * By the time we get here, classifier guarantees:
 * - at most one stroke
 * - solid strokes only
 * - CENTER alignment only
 * - no dashPattern (those go to SVG)
 */
export function pushStroke(rules: string[], strokes: Stroke[]) {
  if (!strokes || strokes.length === 0) return;
  if (strokes.length > 1) return;

  const s = strokes[0];

  // Only solid with color can map to CSS border.
  if (s.kind !== "solid" || !s.color) return;

  // Dashed pattern: -> render as SVG
  if (Array.isArray(s.dashPattern) && s.dashPattern.length > 0) return;

  if (s.alignment === "CENTER") {
    rules.push(`border:${px(s.width)} solid ${rgba(s.color)};`);
    return;
  }

  // defensive check; classifier should prevent this
  if (s.alignment === "INSIDE") {
    rules.push(`box-shadow:inset 0 0 0 ${px(s.width)} ${rgba(s.color)};`);
  } else if (s.alignment === "OUTSIDE") {
    rules.push(`box-shadow:0 0 0 ${px(s.width)} ${rgba(s.color)};`);
  }
}

/**
 * Effects → CSS box-shadow.
 *
 * Classifier guarantees:
 * - at most one shadow effect
 * - no blur effects (those renders as SVG)
 */
export function pushEffects(rules: string[], effects: Effect[]) {
  if (!effects || effects.length === 0) return;

  const shadows = effects.filter(
    (e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"
  );
  if (!shadows.length) return;

  // defensive: classifier should prevent shadows
  const shadowStr = shadows
    .map((e) => {
      const x = px(e.x ?? 0);
      const y = px(e.y ?? 0);
      const blur = px(e.blur ?? 0);
      const spread = px(e.spread ?? 0);
      const col = e.color ? rgba(e.color) : "rgba(0,0,0,0.25)";
      const inset = e.type === "INNER_SHADOW" ? " inset" : "";
      return `${x} ${y} ${blur} ${spread} ${col}${inset}`;
    })
    .join(",");

  rules.push(`box-shadow:${shadowStr};`);
  // Blurs and other complex effects are handled via SVG.
}

export function typographyRules(t: Typography): string[] {
  const out: string[] = [];
  const fontFamily = (t.fontFamily || "").trim();

  out.push(`font-family:${fontFamily}, system-ui, sans-serif;`);
  out.push(`font-size:${px(t.fontSize)};`);

  if (t.fontWeight && Number.isFinite(t.fontWeight)) {
    out.push(`font-weight:${t.fontWeight};`);
  }

  if (t.lineHeightPx) out.push(`line-height:${px(t.lineHeightPx)};`);
  if (t.letterSpacing) out.push(`letter-spacing:${px(t.letterSpacing)};`);

  if (t.textAlignHorizontal) {
    const align =
      t.textAlignHorizontal === "CENTER"
        ? "center"
        : t.textAlignHorizontal === "RIGHT"
        ? "right"
        : t.textAlignHorizontal === "JUSTIFIED"
        ? "justify"
        : "left";
    out.push(`text-align:${align};`);
  }

  if (t.textDecoration && t.textDecoration !== "NONE") {
    const deco =
      t.textDecoration === "UNDERLINE"
        ? "underline"
        : t.textDecoration === "STRIKETHROUGH"
        ? "line-through"
        : "none";
    out.push(`text-decoration:${deco};`);
  }

  return out;
}

export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[
        m
      ]!)
  );
}

export function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function cssForScaleMode(scale: ImageFillInfo["scaleMode"]): string[] {
  switch (scale) {
    case "FILL":
      return [
        "background-position:center;",
        "background-repeat:no-repeat;",
        "background-size:cover;",
      ];
    case "FIT":
      return [
        "background-position:center;",
        "background-repeat:no-repeat;",
        "background-size:contain;",
      ];
    case "TILE":
      return ["background-repeat:repeat;", "background-size:auto;"];
    case "CROP":
      // Best-effort: exact crop would require positioning math or wrapper
      return [
        "background-position:center;",
        "background-repeat:no-repeat;",
        "background-size:cover;",
        "overflow:hidden;",
      ];
    default:
      return [
        "background-position:center;",
        "background-repeat:no-repeat;",
        "background-size:cover;",
      ];
  }
}

// ---------- internal helpers ----------

function gradientStopsToCss(stops: ColorStop[]): string {
  return stops
    .map((s) => {
      const color = rgba(s.color);
      const posPercent = Math.round((s.position ?? 0) * 1000) / 10;
      return `${color} ${posPercent}%`;
    })
    .join(", ");
}
