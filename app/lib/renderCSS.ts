import { ClassifiedNode } from "@/app/lib/classifyNode";
import {
  clamp01,
  cssClass,
  cssForScaleMode,
  pushEffects,
  pushFill,
  pushStroke,
  px,
  traverse,
  typographyRules,
} from "./utils/render";
import { ImageAssetMap } from "./imageMapper";
import { Fill, RGBA } from "@/app/type/normalized";

export function buildStyles(
  rootFrames: ClassifiedNode[],
  imageAssets?: ImageAssetMap
): string {
  const chunks: string[] = [];

  for (const frame of rootFrames) {
    traverse(frame, (node) => {
      const cls = cssClass(node.id);
      const rules: string[] = [];

      // --- Layout ---
      if (node.layout.display === "absolute") {
        const { x = 0, y = 0, width, height } = node.layout;
        rules.push(`position:absolute;left:${px(x)};top:${px(y)};`);
        if (width != null) rules.push(`width:${px(width)};`);
        if (height === 'auto') {
          rules.push('height:auto;');
        } else if (height != null) {
          rules.push(`height:${px(height)};`);
        }
      } else if (node.layout.display === "flex") {
        const { direction, gap, padding, align, justify, width, height } =
          node.layout;
        rules.push(`display:flex;`);
        rules.push(`position:relative;`);
        if (direction) rules.push(`flex-direction:${direction};`);
        if (gap != null) rules.push(`gap:${px(gap)};`);
        if (padding) {
          rules.push(
            `padding:${px(padding.top)} ${px(padding.right)} ${px(
              padding.bottom
            )} ${px(padding.left)};`
          );
        }
        if (align) {
          const alignCss =
            align === "start"
              ? "flex-start"
              : align === "end"
              ? "flex-end"
              : align; // 'center' | 'stretch'
          if (alignCss) rules.push(`align-items:${alignCss};`);
        }
        if (justify) {
          const justifyCss =
            justify === "start"
              ? "flex-start"
              : justify === "end"
              ? "flex-end"
              : justify; // 'center' | 'space-between'
          if (justifyCss) rules.push(`justify-content:${justifyCss};`);
        }
        if (width != null) rules.push(`width:${px(width)};`);
        if (height === 'auto') {
          rules.push('height:auto;');
        } else if (height != null) {
          rules.push(`height:${px(height as number)};`);
        }
      }

      // --- Visual style ---
      // For SVG nodes, the exported SVG is the visual source of truth.
      if (node.renderAs !== "svg") {
        if (node.renderAs === "html-text") {
          // Text color comes from fills: treat the first solid fill as the text color.
          applyTextColorFromFills(rules, node.style.fills);
          // No background fill on text here: backgrounds are separate shapes in Figma.
        } else {
          // Non-text nodes: fills affect backgrounds.
          pushFill(rules, node.style.fills);
        }

        // Strokes and effects apply to HTML-rendered nodes (including simple text)
        pushStroke(rules, node.style.strokes);
        pushEffects(rules, node.style.effects);

        if (node.style.opacity != null && node.style.opacity < 1) {
          rules.push(`opacity:${clamp01(node.style.opacity)};`);
        }

        const radius = node.style.borderRadius;
        if (typeof radius === "number") {
          rules.push(`border-radius:${px(radius)};`);
        } else if (radius) {
          rules.push(
            `border-radius:${px(radius.topLeft)} ${px(radius.topRight)} ${px(
              radius.bottomRight
            )} ${px(radius.bottomLeft)};`
          );
        }
      }

      // --- Typography & text-specific rules ---
      if (node.renderAs === "html-text" && node.style.typography) {
        // Typography (font family, size, weight, line height, etc.)
        rules.push(...typographyRules(node.style.typography));
        // Preserve Figma line breaks and spacing
        rules.push("white-space:pre-wrap;");
      }

      // --- Image assets (background images) ---
      if (imageAssets && imageAssets[node.id]) {
        const asset = imageAssets[node.id];
        rules.push(`background-image:url("${asset.relativePath}");`);
        rules.push(...cssForScaleMode(asset.scaleMode));
      }

      if (rules.length) {
        chunks.push(`.${cls}{${rules.join("")}}`);
      }
    });
  }

  // global root styles
  chunks.unshift(`:root{color-scheme:light;}`);
  return chunks.join("\n");
}

// --- helpers ---

function applyTextColorFromFills(rules: string[], fills?: Fill[]): void {
  if (!fills || fills.length === 0) return;

  // Take the first solid fill as the primary text color
  const solidFill = fills.find((f) => f.kind === "solid");
  if (!solidFill) return;

  rules.push(`color:${rgbaToCss(solidFill.color)};`);
}

function rgbaToCss(color: RGBA): string {
  // Normalized 0..1 to 0..255
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = clamp01(color.a);
  return `rgba(${r},${g},${b},${a})`;
}
