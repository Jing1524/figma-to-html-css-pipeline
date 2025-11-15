## Figma → HTML/CSS Conversion System

**Tech Stack**: Next.js 15, TypeScript
**Approach**: Deterministic Pipeline with SVG Fallbacks

---

## 1. Overview

The system programmatically converts any given Figma design file into static HTML and CSS that closely matches the original design.

It prioritizes browser-native rendering (HTML/CSS) for layout and typography, and selectively uses SVG fallbacks for complex visuals (e.g., gradient borders, masks, multiple shadows) to preserve visual accuracy.

This approach generalizes to any Figma mock by analyzing node types and their properties rather than relying on hard-coded assumptions about structure or naming.

---

## 2: Design goal

**Visual Fidelity** — The generated output should be as close as possible to the Figma design.

**Generality** — Works for any file, not just the provided mock

**Simplicity** — keep the pipeline linear: fetch → normalize → classify → render

**Transparency** — Each decision (e.g., fallback to SVG) is explicit and traceable within the manifest

**Performance** — Cached API responses and assets to minimize rate limits and rebuild times

---

## 3: High-level Architecture

### Data flow overview

`User Input (fileKey, token) -> Figma REST API -> Normalized Tree (simplified node structure) -> Classification (HTML vs SVG rendering) -> Renderer (HTML/CSS/SVG generator) -> Output (index.html + styles.css)`

---

## 4. Key Components

### 4.1 Fetching Data

**Endpoint**: GET /v1/files/:fileKey -> Returns document tree, styles, and component metadata.

              GET /v1/images/:fileKey?ids=...&format=svg|png -> Used for vector or masked nodes requiring SVG fallback.

**Authentication**: FIGMA_TOKEN from environment passed in the request header.

**Caching**: Responses cached to disk (.cache/figma/) keyed by fileKey:lastModified.
Images/SVGs are also cached on disk and mirrored into /public/generated/<fileKey>/assets.

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
    padding?: { top: number; right: number; bottom: number; left: number };
    align?: 'start' | 'center' | 'end' | 'stretch';
    justify?: 'start' | 'center' | 'end' | 'space-between';
    width?: number;
    height?: number | 'auto';
    x?: number;
    y?: number;
  };

  style: {
    fills: Fill[];
    strokes: Stroke[];
    borderRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
    effects: Effect[];
    typography?: Typography;
    opacity?: number;
    blendMode?: string;
    hasMask?: boolean;
  };

  text?: string; // for text nodes
  children: NormalizedNode[];
}
```

This makes the rendering logic easy to reason about, and avoid juggling Figma’s dozens of property names.

---

### 4.3 Classification (Deciding Render Method)

**Each node is classified as:**

`html`: Safe for CSS (simple fills, borders, and layout)

`html-text`: Text node → <p>, <span>, <h\*>

`svg`: Complex shapes or effects that CSS can’t reproduce exactly

**Classification is capability-based and deterministic:**

Text is rendered as real HTML text unless it has overly complex visual treatments that require SVG.

Nodes with masks, multiple strokes, gradient strokes, or unsupported blend/effect combinations are rendered as SVG.

Nodes with simple strokes, fills (including simple linear gradients and image fills), and simple shadows remain in HTML/CSS.

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

**Layout Strategy (Current)**

The current layout strategy is absoluteBoundingBox-driven:

For each node, the system reads absoluteBoundingBox from Figma (x, y, width, height).

For children, coordinates are made relative to the parent’s bounding box.

In CSS:

Root frames are containers with position: relative.

Children with display: "absolute" are rendered with position: absolute; left: x; top: y;.

Current layout strategy uses Figma’s absoluteBoundingBox for all nodes.
This guarantees deterministic, file-agnostic rendering at the designed size, but auto-layout subtleties (like vertical gaps between siblings) aren’t fully solved yet. A future iteration can reintroduce auto-layout via flex or Yoga to close the last few pixel gaps.

Auto-layout metadata (layoutMode, padding, itemSpacing, etc.) is still read and can inform future improvements, but the primary positioning is absolute.

**HTML Generation**

Frames → <div class="...">

Text → <p class="...">Text content</p> (with extracted characters as content)

SVG-classified nodes → <img class="..." src="./assets/<id>.svg" alt="" />

Image-fill nodes (where safe for HTML) → background images via CSS

**CSS Generation**

Absolute layout:

position: absolute; left: x; top: y; width/height

(When needed for containers) position: relative is applied to parents.

Visual styling:

Solid fills → background-color

Multiple or gradient fills (where supported) → background / background-image

Borders and border-radius

Shadows → box-shadow

Typography → font-family, font-size, line-height, letter-spacing, font-weight

Text color is derived from the first solid fill on text nodes.

Dashed strokes that are safe to approximate in CSS are mapped to border-style: dashed with border-width.

**SVG Generation**

For nodes classified as svg, Figma’s /images endpoint is used with format=svg.

SVGs are downloaded once, cached on disk, and copied into public/generated/<fileKey>/assets/.

HTML refers to these via <img src="./assets/<nodeId>.svg" />.

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
  "meta": {
    "fileKey": "aXmB...",
    "name": "My Figma File",
    "lastModified": "2025-11-11",
    "rendererVersion": "1.0.0"
  },
  "counts": {
    "total": 42,
    "html": 30,
    "htmlText": 10,
    "svg": 2
  },
  "warnings": [
    "Unsupported fill type: EMOJI"
  ],
  "nodes": [
    { "id": "3", "name": "Primary Button", "type": "frame", "renderAs": "html" },
    { "id": "4", "name": "Gradient Border Card", "type": "frame", "renderAs": "svg" }
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

Rendered HTML/CSS visually matches Figma (layout, color, spacing, typography, borders, gradients) within a small tolerance.

System generalizes — can process any Figma file, not just the test mock.

Logic is readable, modular, and easy to extend.

Output is static (HTML, CSS, SVG, PNG) with no client-side rendering frameworks at runtime.

## 7. Trade-offs

**CSS-first + SVG fallback**

Pros: Clean, lightweight, good performance, accessible text.

Cons: Some highly complex visuals always drop to SVG.

**AbsoluteBoundingBox layout**

Pros: Deterministic, file-agnostic, matches Figma’s computed coordinates.

Cons: Auto-layout subtleties (e.g., hugging, baseline alignment, some vertical spacing nuances) are not fully reproduced.

**Disk caching, not DB**

Pros: Easy to set up locally, minimal infra.

Cons: Less suited for multi-user or distributed deployments.

**Rule-based classifier**

Pros: Transparent and easy to reason about.

Cons: Needs maintenance as Figma and CSS capabilities evolve.

**Next.js + TypeScript**

Pros: Familiar stack, good DX, simple server+client wiring.

---

## 8. Developer UI

A small client-side UI is included:

- Accepts either a full Figma URL or a raw file key.

- Extracts the fileKey with a helper (extractFileKey).

- Calls /api/convert with fileKey.

- Uses AbortController to avoid race conditions (cancels previous in-flight requests when a new one is started).

- Persists:

  - Last input

  - Last result JSON

  - Last error
    across page refresh via localStorage.

- Renders:

  - Raw JSON response (meta, stats, output)

  - A button linking to /generated/<fileKey>/index.html (“Open generated preview”).

This makes it quick to iterate on the pipeline and visually inspect results.

---

## 9. Future Improvements (Nice-to-Haves)

- introduce proper auto-layout handling (via flexbox or a layout engine such as Yoga) for:

  - Hug contents

  - Fill container behavior

  - Baseline alignment

- Smarter text layout:

  - Mixed-style spans

  - Rich text mappings (marks inside a single Figma text node)

- Component deduplication / reuse for repeated Figma components.

- CLI mode for:

  - Batch conversion

  - Automated regression tests

  - CI integration.

---

## 10. Summary

This project’s goal is to programmatically translate Figma designs into clean, static HTML and CSS, focusing on fidelity, generalization, and clarity of engineering decisions.

The current layout strategy intentionally uses Figma’s absoluteBoundingBox for all nodes, which guarantees deterministic, file-agnostic rendering at the designed size. Auto-layout subtleties are a known, documented limitation and are candidates for a future iteration that reintroduces more sophisticated layout handling (e.g., via flexbox or Yoga).

The architecture is intentionally simple, explainable, and expandable. It demonstrates sound judgment and keeps the door open for deeper layout fidelity in later versions.
