export type RenderKind = "frame" | "text" | "vector" | "image";

export interface NormalizedNode {
  id: string;
  name: string;
  type: RenderKind;
  layout: LayoutModel;
  style: StyleModel;
  text?: string; // for simple text nodes
  spans?: TextSpan[]; // for rich text nodes
  children: NormalizedNode[];
}

export type LayoutModel = {
  // generic box sizing
  width?: number | "auto";
  height?: number | "auto";

  // positioning
  position?: "static" | "relative" | "absolute";
  x?: number;
  y?: number;

  // layout model
  display?: "block" | "flex";
  flexDirection?: "row" | "column";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around";
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";

  gap?: number;

  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
};

export interface StyleModel {
  fills: Fill[];
  strokes: Stroke[];
  borderRadius?: number | BorderRadii;
  effects: Effect[];
  typography?: Typography;
  opacity?: number; // 0..1
  blendMode?: string; // 'NORMAL', etc.
  hasMask?: boolean;
}

export type BorderRadii = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

export type Fill =
  | { kind: "solid"; color: RGBA }
  | { kind: "linearGradient"; stops: ColorStop[]; angle: number } // degrees
  | { kind: "radialGradient"; stops: ColorStop[] }
  | { kind: "conicGradient"; stops: ColorStop[]; angle: number }
  | {
      kind: "image";
      imageRef: string;
      scaleMode: "FILL" | "FIT" | "TILE" | "CROP";
    };

export interface Stroke {
  kind: "solid" | "gradient";
  alignment: "CENTER" | "INSIDE" | "OUTSIDE";
  width: number;
  color?: RGBA;
  dashed?: boolean;
  gradient?: { stops: ColorStop[]; angle?: number };
  dashPattern?: number[];
}

export interface Effect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  color?: RGBA;
}

export interface Typography {
  fontFamily: string;
  fontPostScriptName?: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize: number;
  lineHeightPx?: number;
  letterSpacing?: number; // px
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface ColorStop {
  position: number;
  color: RGBA;
}

export interface NormalizationResult {
  frames: NormalizedNode[]; // top-level renderable frames
  warnings: string[];
  stats: {
    nodesTotal: number;
    frames: number;
    texts: number;
    vectors: number;
    images: number;
    gradients: number;
    masks: number;
  };
}

type ImageFill = Extract<Fill, { kind: "image" }>;
export type ImageScaleMode = ImageFill["scaleMode"];

export type ImageFillInfo = {
  nodeId: string;
  scaleMode: "FILL" | "FIT" | "TILE" | "CROP";
};

export interface TextSpan {
  text: string;
}
