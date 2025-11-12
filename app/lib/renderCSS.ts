"use server";
import "server-only";
import { ClassifiedNode } from "@/app/lib/classifyNode";
import {
  clamp01,
  cssClass,
  pushEffects,
  pushFill,
  pushStroke,
  px,
  traverse,
  typographyRules,
} from "./utils/render";

export function buildStyles(rootFrames: ClassifiedNode[]): string {
  const chunks: string[] = [];

  for (const frame of rootFrames) {
    traverse(frame, (node) => {
      const cls = cssClass(node.id);
      const rules: string[] = [];

      // Layout
      if (node.layout.display === "absolute") {
        const { x = 0, y = 0, width, height } = node.layout;
        rules.push(`position:absolute; left:${px(x)}; top:${px(y)};`);
        if (width) rules.push(`width:${px(width)};`);
        if (height) rules.push(`height:${px(height)};`);
      } else if (node.layout.display === "flex") {
        const { direction, gap, padding, align, justify, width, height } =
          node.layout;
        rules.push(`display:flex;`);
        if (direction) rules.push(`flex-direction:${direction};`);
        if (gap != null) rules.push(`gap:${px(gap)};`);
        if (padding) {
          rules.push(
            `padding:${px(padding.top)} ${px(padding.right)} ${px(
              padding.bottom
            )} ${px(padding.left)};`
          );
        }
        if (align) rules.push(`align-items:${align};`);
        if (justify) rules.push(`justify-content:${justify};`);
        if (width) rules.push(`width:${px(width)};`);
        if (height) rules.push(`height:${px(height)};`);
      }

      // Visual style
      pushFill(rules, node.style.fills);
      pushStroke(rules, node.style.strokes);
      pushEffects(rules, node.style.effects);
      if (node.style.opacity != null && node.style.opacity < 1) {
        rules.push(`opacity:${clamp01(node.style.opacity)};`);
      }

      const radius = node.style.borderRadius;
      if (typeof radius === "number")
        rules.push(`border-radius:${px(radius)};`);
      else if (radius) {
        rules.push(
          `border-radius:${px(radius.topLeft)} ${px(radius.topRight)} ${px(
            radius.bottomRight
          )} ${px(radius.bottomLeft)};`
        );
      }

      // Typography only on text nodes (html-text)
      if (node.renderAs === "html-text" && node.style.typography) {
        rules.push(...typographyRules(node.style.typography));
      }

      if (rules.length) {
        chunks.push(`.${cls}{${rules.join("")}}`);
      }
    });
  }

  // Root page defaults
  chunks.unshift(`:root{color-scheme:light;}`);
  return chunks.join("\n");
}
