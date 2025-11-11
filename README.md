## Figma → HTML/CSS Conversion System

**Tech Stack**: Next.js 15, TypeScript
**Approach**: Deterministic Pipeline with SVG Fallbacks

---

## 1. Overview

The system programmatically converts any given Figma design file into clean, static HTML and CSS that's visually identical to the original design.
It prioritizes browser-native rendering (HTML/CSS) for typical layouts and typography, and selectively uses SVG fallbacks for complex visuals (e.g., gradient borders, masks, multiple shadows) to preserve visual accuracy.

This approach generalizes to any Figma mock by analyzing node types and their properties rather than relying on hard-coded assumptions about structure or naming.

---

## 2: Design goal

**Visual Fidelity** — The generated output must look identical to the Figma design

**Generality** — Works for any file, not just the provided mock

**Simplicity** — keep the pipeline linear: fetch → normalize → classify → render

**Transparency** — Each decision (e.g., fallback to SVG) is explicit and traceable within the manifest

**Performance** — Cached API responses and assets to minimize rate limits and rebuild times

---

## 3: High-level Architecture

### 1: Data flow overview

`User Input (fileKey, token) -> Figma REST API -> Normalized Tree (simplified node structure) -> Classification (HTML vs SVG rendering) -> Renderer (HTML/CSS/SVG generator) -> Output (index.html + styles.css)`

---

## 4. Key Components

### 4.1 Fetching Data

**Endpoint**: GET /v1/files/:fileKey -> Returns document tree, styles, and component metadata.

Optional: GET /v1/images/:fileKey?ids=...&format=svg|png -> Used for vector or masked nodes requiring SVG fallback.

**Authentication**: User-supplied token passed in the request header.

**Caching**: Responses cached to disk (.cache/figma/) keyed by fileKey:lastModified.

**Rationale**:
Caching ensures quick repeated runs and prevents Figma API rate limit errors during testing.

---

### 4.2 Normalization

Raw Figma data is verbose and nested, transform it into a minimal intermediate model that focuses on what’s needed for layout and style rendering.

```
interface NormalizedNode {
  id: string;
  name: string;
  type: 'frame' | 'text' | 'vector' | 'image';
  layout: {
    display: 'flex' | 'grid' | 'absolute';
    direction?: 'row' | 'column';
    gap?: number;
    padding?: number;
    align?: string;
    justify?: string;
    width?: number;
    height?: number;
  };
  style: {
    fills?: Fill[];
    strokes?: Stroke[];
    borderRadius?: number;
    effects?: Effect[];
    typography?: Typography;
    opacity?: number;
    blendMode?: string;
  };
  children?: NormalizedNode[];
}

```

This makes the rendering logic easy to reason about, and avoid juggling Figma’s dozens of property names.

---

### 4.3 Classification (Deciding Render Method)

Each node is classified as:

`html`: Safe for CSS (simple fills, borders, and layout)

`html-text`: Text node → <p>, <span>, <h\*>

`svg`: Complex shapes or effects that CSS can’t reproduce exactly

**Rules**(simplified, deterministic):

```
// Classification based on CSS capability boundaries (not file-specific rules)
if (node.type === 'text') return 'html-text';
if (node.style.mask || node.style.strokes?.length > 1) return 'svg';
if (node.style.fills?.some(f => f.type !== 'SOLID')) return 'svg';
if (node.style.blendMode && node.style.blendMode !== 'NORMAL') return 'svg';
return 'html';
```

**Rationale**:
Simple logic ensures predictability and transparency, can quickly explain why something is SVG.

---

### 4.3.1 Generalization Principle

The classifier is designed to generalize across any Figma file, not just the provided mock.
It achieves this by classifying nodes based on feature capability, not file-specific structure or naming.

Each rule reflects a stable boundary between what CSS/HTML can and cannot accurately render — for example, CSS supports a single border and solid fills, but not multiple strokes or non-linear gradients.
Because these capabilities are consistent across browsers, the logic remains valid for any Figma design, regardless of its content or complexity.

This makes the system extensible and reliable: when new Figma features appear (e.g., blend modes, filters), they can simply be added as new capability flags without rewriting core logic.

---

### 4.4 Rendering

**HTML Generation**

• Auto layout → Flexbox

    • layoutMode: HORIZONTAL → display: flex; flex-direction: row

    • layoutMode: VERTICAL → display: flex; flex-direction: column

    • Apply padding, gap, alignments directly from Figma metadata.

• Absolute frames → position: absolute with computed coordinates.

• Images → background-image with cover, contain, or repeat per Figma’s scale mode.

**CSS Generation**

• Solid fills → background-color

• Borders → border, border-radius

• Shadows → box-shadow

• Gradients → background: linear-gradient(...)

• Typography → font-size, line-height, letter-spacing, font-family

• Fallback fonts (Inter, Roboto) where unavailable

**SVG Generation**

• Export complex nodes directly from Figma API’s image endpoint.

• Inline the SVG or reference it from <img> depending on reuse frequency.

**Output Example**

```
public/generated/<fileKey>/
├── index.html
├── styles.css
└── assets/
     ├── node_1.svg
     └── node_2.svg
```

### 4.5 Manifest (for debugging)

Generate a small JSON manifest for debugging and easy to reason about conversion results:

```
{
  "meta": { "fileKey": "aXmB...", "lastModified": "2025-11-11" },
  "nodes": [
    { "id": "3", "name": "Primary Button", "renderAs": "html" },
    { "id": "4", "name": "Gradient Border Card", "renderAs": "svg" }
  ]
}
```

---

## 5. Testing & Validation

Visual Comparison

• Export a PNG from Figma for each frame.

• Use Playwright to render the generated HTML and compare via `pixelmatch`.

• Pass condition: < 2px average difference.

Structural Check

• Verify node counts, text content, and layer order match Figma.

Manual QA

• Inspect gradients, borders, and typography in browser manually for accuracy.

---

## 6. Success Criteria Alignment

Rendered HTML/CSS visually matches Figma (layout, color, spacing, typography, borders, gradients).
System generalizes — can process any Figma file (not just test mock).
Logic is easy to read, follow, and extend.
No unnecessary complexity or runtime frameworks.

## 7. Trade-offs

**CSS-first + SVG fallback**: Clean, lightweight, visually reliable
**No custom layout solver**: Simplicity > pixel-perfection; Flexbox matches Figma auto layout closely enough
**Disk caching, not DB**: Easier to set up locally; sufficient for scope
**Rule-based classifier**: Faster to implement and reason about than heuristic “scoring”
**Next.js + TypeScript**: Familiar stack, easy to test

---

## 8. Future Improvements (Nice-to-Haves)

Yoga or browser-measured layout solver for 1:1 “hug” sizing.

Smarter text layout (handling mixed-style spans, alignment baselines).

Component deduplication (for repeated Figma components).

CLI mode for automated regression tests and CI integration.

---

## 9. Summary

This project’s goal is to programmatically translate Figma designs into clean, static HTML and CSS, focusing on fidelity, generalization, and clarity of engineering decisions.
The architecture is intentionally simple, explainable, and expandable. It demonstrates sound judgment, not overcomplication.
