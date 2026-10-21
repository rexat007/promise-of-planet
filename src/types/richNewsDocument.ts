export type TextDirection = 'rtl' | 'ltr' | 'auto';
export type Alignment = 'right' | 'left' | 'center' | 'justify';

export type MarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'link';

export interface LinkMarkAttrs {
  href: string;
  target?: '_blank' | '_self';
  rel?: string;
}

export interface LinkMark {
  type: 'link';
  attrs: LinkMarkAttrs;
}

export interface SimpleMark {
  type: 'bold' | 'italic' | 'underline' | 'strike';
}

export type Mark = SimpleMark | LinkMark;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface HardBreakNode {
  type: 'hardBreak';
}

export type InlineNode = TextNode | HardBreakNode;

export interface ParagraphAttrs {
  dir?: TextDirection;
  textAlign?: Alignment;
}

export interface ParagraphNode {
  type: 'paragraph';
  attrs?: ParagraphAttrs;
  content?: InlineNode[];
}

export interface HeadingAttrs {
  level: 2 | 3 | 4;
  dir?: TextDirection;
  textAlign?: Alignment;
}

export interface HeadingNode {
  type: 'heading';
  attrs: HeadingAttrs;
  content?: InlineNode[];
}

export interface BlockquoteAttrs {
  dir?: TextDirection;
}

export interface BlockquoteNode {
  type: 'blockquote';
  attrs?: BlockquoteAttrs;
  content?: BlockNode[];
}

export interface BulletListNode {
  type: 'bulletList';
  content: ListItemNode[];
}

export interface OrderedListAttrs {
  start?: number;
}

export interface OrderedListNode {
  type: 'orderedList';
  attrs?: OrderedListAttrs;
  content: ListItemNode[];
}

export interface ListItemNode {
  type: 'listItem';
  content: BlockNode[];
}

export interface HorizontalRuleNode {
  type: 'horizontalRule';
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | BulletListNode
  | OrderedListNode
  | ListItemNode
  | HorizontalRuleNode;

export type ProseMirrorNode = BlockNode | InlineNode;

export interface ProseMirrorDoc {
  type: 'doc';
  content: BlockNode[];
}

export interface RichNewsDocumentWrapper {
  schemaVersion: 1;
  doc: ProseMirrorDoc;
  updatedAt?: string;
}

export interface ValidationLimits {
  maxJsonSizeBytes: number;
  maxNodeCount: number;
  maxTextLength: number;
  maxNestingDepth: number;
}

export const DEFAULT_VALIDATION_LIMITS: ValidationLimits = {
  maxJsonSizeBytes: 500_000, // 500 KB
  maxNodeCount: 2000,
  maxTextLength: 100_000,
  maxNestingDepth: 10,
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/* ==========================================
 * Schema Version 2 Definitions (Opt-In V2)
 * ========================================== */

export type ImageWidthV2 = "25%" | "50%" | "75%" | "100%";
export type ImageLayoutV2 = "float-start" | "float-end" | "block-center" | "block-full";

export interface EditorialImageNodeAttrsV2 {
  assetId: string;
  altAr: string;
  width: ImageWidthV2;
  layout: ImageLayoutV2;
  altEn?: string;
  captionAr?: string;
  captionEn?: string;
}

export interface EditorialImageNodeV2 {
  type: "editorialImage";
  attrs: EditorialImageNodeAttrsV2;
}

export type BlockNodeV2 =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | BulletListNode
  | OrderedListNode
  | ListItemNode
  | HorizontalRuleNode
  | EditorialImageNodeV2;

export type ProseMirrorNodeV2 = BlockNodeV2 | InlineNode;

export interface ProseMirrorDocV2 {
  type: "doc";
  content: BlockNodeV2[];
}

export interface RichNewsDocumentWrapperV2 {
  schemaVersion: 2;
  doc: ProseMirrorDocV2;
  updatedAt?: string;
}

