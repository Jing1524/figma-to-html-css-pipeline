import {
  Effect,
  Fill,
  ImageFillInfo,
  Stroke,
  Typography,
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

export function pushFill(rules: string[], fills: Fill[]) {
  if (!fills || fills.length === 0) return;
  // Capability policy: only SOLID here; others handled via SVG fallback in HTML stage
  const solid = fills.find((f) => f.kind === "solid");
  if (solid) rules.push(`background:${rgba(solid.color)};`);
}

export function pushStroke(rules: string[], strokes: Stroke[]) {
  if (!strokes || strokes.length === 0) return;
  if (strokes.length > 1) return; // multi-stroke → SVG handled in HTML stage
  const s = strokes[0];

  // Only solid CENTER stroke maps cleanly to CSS border.
  if (s.color && !s.gradient && s.alignment === "CENTER") {
    rules.push(
      `border:${px(s.width)} solid ${rgba({ ...s.color, a: s.color.a ?? 1 })};`
    );
  } else if (s.color && !s.gradient && s.alignment === "INSIDE") {
    rules.push(
      `box-shadow: inset 0 0 0 ${px(s.width)} ${rgba({
        ...s.color,
        a: s.color.a ?? 1,
      })};`
    );
  } else if (s.color && !s.gradient && s.alignment === "OUTSIDE") {
    rules.push(
      `box-shadow: 0 0 0 ${px(s.width)} ${rgba({
        ...s.color,
        a: s.color.a ?? 1,
      })};`
    );
  }
}

export function pushEffects(rules: string[], effects: Effect[]) {
  if (!effects || effects.length === 0) return;
  const shadows = effects.filter(
    (e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"
  );
  if (shadows.length) {
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
  }
  // Blurs/mix-blend beyond this are handled via SVG
}

export function typographyRules(t: Typography): string[] {
  const out: string[] = [];
  out.push(`font-family:${CSS.escape(t.fontFamily)}, system-ui, sans-serif;`);
  out.push(`font-size:${px(t.fontSize)};`);
  if (t.lineHeightPx) out.push(`line-height:${px(t.lineHeightPx)};`);
  if (t.letterSpacing) out.push(`letter-spacing:${px(t.letterSpacing)};`);
  // text align maps on container; keep minimal here
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
      // Best-effort: same as FILL; exact crop would require positioning math or wrapper
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
