import type {
  RichNewsDocumentWrapper,
  ValidationLimits,
  ValidationResult,
  TextDirection,
  Alignment,
  ParagraphNode,
} from "../types/richNewsDocument";
import { DEFAULT_VALIDATION_LIMITS } from "../types/richNewsDocument";

const ALLOWED_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "horizontalRule",
  "text",
  "hardBreak",
]);

const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "link"]);
const ALLOWED_DIRECTIONS = new Set<TextDirection>(["rtl", "ltr", "auto"]);
const ALLOWED_ALIGNMENTS = new Set<Alignment>(["right", "left", "center", "justify"]);

function isSafeUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  
  if (
    trimmed.includes("javascript:") ||
    trimmed.includes("data:") ||
    trimmed.includes("vbscript:") ||
    trimmed.includes("file:") ||
    trimmed.includes("blob:")
  ) {
    return false;
  }

  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#")
  ) {
    return true;
  }

  return false;
}

export function validateRichNewsDocument(
  input: unknown,
  customLimits: Partial<ValidationLimits> = {}
): ValidationResult {
  const limits: ValidationLimits = { ...DEFAULT_VALIDATION_LIMITS, ...customLimits };
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Document wrapper must be a non-null object."] };
  }

  const rawString = JSON.stringify(input);
  if (rawString.length > limits.maxJsonSizeBytes) {
    return {
      valid: false,
      errors: [`Document exceeds maximum payload size of ${limits.maxJsonSizeBytes} bytes.`],
    };
  }

  const wrapper = input as Record<string, any>;

  if (wrapper.schemaVersion !== 1) {
    errors.push(`Unsupported or missing schemaVersion: expected 1, received ${wrapper.schemaVersion}.`);
  }

  if (!wrapper.doc || typeof wrapper.doc !== "object" || wrapper.doc.type !== "doc") {
    errors.push(`Document wrapper must contain a valid root "doc" node with type="doc".`);
    return { valid: false, errors };
  }

  if (!Array.isArray(wrapper.doc.content)) {
    errors.push(`Root "doc" node must contain a "content" array.`);
    return { valid: false, errors };
  }

  let totalNodeCount = 1;
  let totalTextLength = 0;

  function traverseNode(node: any, depth: number): void {
    totalNodeCount++;
    if (depth > limits.maxNestingDepth) {
      errors.push(`Nesting depth of ${depth} exceeds maximum allowed limit of ${limits.maxNestingDepth}.`);
      return;
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push("Invalid node structure: node must be an object.");
      return;
    }

    const { type, attrs, content, marks, text } = node;

    if (!type || typeof type !== "string" || !ALLOWED_NODE_TYPES.has(type)) {
      errors.push(`Disallowed or unknown node type: "${type}".`);
      return;
    }

    if (attrs !== undefined) {
      if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) {
        errors.push(`Node "${type}" attrs must be a non-null object.`);
      } else {
        validateNodeAttributes(type, attrs, errors);
      }
    }

    if (type === "heading") {
      if (!attrs || typeof attrs.level !== "number" || ![2, 3, 4].includes(attrs.level)) {
        errors.push("Heading level must be an integer: 2, 3, or 4.");
      }
    }

    if (type === "orderedList" && attrs && attrs.start !== undefined) {
      if (typeof attrs.start !== "number" || attrs.start < 0 || !Number.isInteger(attrs.start)) {
        errors.push("OrderedList start attribute must be a non-negative integer.");
      }
    }

    if (type === "text") {
      if (typeof text !== "string") {
        errors.push("Text node must contain a string \"text\" property.");
      } else {
        totalTextLength += text.length;
      }

      if (marks !== undefined) {
        if (!Array.isArray(marks)) {
          errors.push("Text node \"marks\" property must be an array.");
        } else {
          validateMarks(marks, errors);
        }
      }
    }

    if (type === "hardBreak") {
      if (content && content.length > 0) {
        errors.push("hardBreak node cannot have children content.");
      }
    }

    if (type === "horizontalRule") {
      if (content && content.length > 0) {
        errors.push("horizontalRule node cannot have children content.");
      }
    }

    if (content !== undefined) {
      if (!Array.isArray(content)) {
        errors.push(`Node "${type}" content must be an array.`);
      } else {
        for (const child of content) {
          traverseNode(child, depth + 1);
        }
      }
    }
  }

  for (const childNode of wrapper.doc.content) {
    traverseNode(childNode, 1);
  }

  if (totalNodeCount > limits.maxNodeCount) {
    errors.push(`Total node count (${totalNodeCount}) exceeds maximum allowed limit of ${limits.maxNodeCount}.`);
  }

  if (totalTextLength > limits.maxTextLength) {
    errors.push(`Total text length (${totalTextLength}) exceeds maximum allowed limit of ${limits.maxTextLength}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateNodeAttributes(type: string, attrs: Record<string, any>, errors: string[]): void {
  const allowedAttrKeys: Record<string, Set<string>> = {
    paragraph: new Set(["dir", "textAlign"]),
    heading: new Set(["level", "dir", "textAlign"]),
    blockquote: new Set(["dir"]),
    orderedList: new Set(["start"]),
    bulletList: new Set([]),
    listItem: new Set([]),
    horizontalRule: new Set([]),
    text: new Set([]),
    hardBreak: new Set([]),
  };

  const allowedKeys = allowedAttrKeys[type] || new Set([]);
  for (const key of Object.keys(attrs)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected attribute "${key}" on node type "${type}".`);
    }
  }

  if (attrs.dir !== undefined && !ALLOWED_DIRECTIONS.has(attrs.dir)) {
    errors.push(`Invalid text direction "${attrs.dir}" on node "${type}". Allowed: rtl, ltr, auto.`);
  }

  if (attrs.textAlign !== undefined && !ALLOWED_ALIGNMENTS.has(attrs.textAlign)) {
    errors.push(`Invalid alignment "${attrs.textAlign}" on node "${type}". Allowed: right, left, center, justify.`);
  }
}

function validateMarks(marks: any[], errors: string[]): void {
  for (const mark of marks) {
    if (!mark || typeof mark !== "object" || Array.isArray(mark)) {
      errors.push("Mark must be an object.");
      continue;
    }

    const { type, attrs } = mark;
    if (!type || !ALLOWED_MARK_TYPES.has(type)) {
      errors.push(`Disallowed or unknown mark type: "${type}".`);
      continue;
    }

    if (type === "link") {
      if (!attrs || typeof attrs !== "object" || typeof attrs.href !== "string") {
        errors.push("Link mark requires an attrs object with a string \"href\".");
      } else if (!isSafeUrl(attrs.href)) {
        errors.push(`Unsafe link URL protocol in mark: "${attrs.href}".`);
      }

      if (attrs) {
        for (const key of Object.keys(attrs)) {
          if (!["href", "target", "rel"].includes(key)) {
            errors.push(`Unexpected attribute "${key}" in link mark.`);
          }
        }
      }
    } else if (attrs && Object.keys(attrs).length > 0) {
      errors.push(`Mark type "${type}" should not contain attributes.`);
    }
  }
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function convertPlainTextToRichDocument(
  text: string,
  defaultDir: TextDirection = "rtl"
): RichNewsDocumentWrapper {
  if (!text || text.trim() === "") {
    return {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [],
      },
    };
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const rawParagraphs = normalized.split(/\n\n+/);

  const content: ParagraphNode[] = rawParagraphs.map(pString => {
    const dir: TextDirection = containsArabic(pString) ? "rtl" : defaultDir;
    const lines = pString.split("\n");

    const inlineContent: ParagraphNode["content"] = [];
    lines.forEach((line, idx) => {
      if (line.length > 0) {
        inlineContent.push({
          type: "text",
          text: line,
        });
      }
      if (idx < lines.length - 1) {
        inlineContent.push({
          type: "hardBreak",
        });
      }
    });

    return {
      type: "paragraph",
      attrs: { dir },
      content: inlineContent,
    };
  });

  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content,
    },
  };
}

export function extractPlainTextFromRichDocument(input: unknown): string {
  if (!input || typeof input !== "object") return "";

  const wrapper = input as Record<string, any>;
  const doc = wrapper.doc || (wrapper.type === "doc" ? wrapper : null);

  if (!doc || !Array.isArray(doc.content)) return "";

  const blockTexts: string[] = [];

  function collectText(node: any): string {
    if (!node || typeof node !== "object") return "";

    if (node.type === "text" && typeof node.text === "string") {
      return node.text;
    }

    if (node.type === "hardBreak") {
      return "\n";
    }

    if (Array.isArray(node.content)) {
      return node.content.map(collectText).join("");
    }

    return "";
  }

  for (const block of doc.content) {
    const text = collectText(block);
    if (text.length > 0) {
      blockTexts.push(text);
    }
  }

  return blockTexts.join("\n\n");
}

export function serializeRichDocument(docWrapper: RichNewsDocumentWrapper): string {
  return JSON.stringify(docWrapper, null, 2);
}

export function parseRichDocument(jsonString: string): RichNewsDocumentWrapper {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new Error(`JSON_PARSE_ERROR: Failed to parse rich news document: ${err.message}`);
  }

  const result = validateRichNewsDocument(parsed);
  if (!result.valid) {
    throw new Error(`VALIDATION_ERROR: Rich news document contract violation: ${result.errors.join("; ")}`);
  }

  return parsed as RichNewsDocumentWrapper;
}

/* ==========================================
 * Opt-In Schema Version 2 Validator
 * ========================================== */

const ALLOWED_NODE_TYPES_V2 = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "horizontalRule",
  "editorialImage",
  "text",
  "hardBreak",
]);

const ALLOWED_WIDTHS_V2 = new Set(["25%", "50%", "75%", "100%"]);
const ALLOWED_LAYOUTS_V2 = new Set(["float-start", "float-end", "block-center", "block-full"]);
const SAFE_ASSET_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function validateRichNewsDocumentV2(
  input: unknown,
  customLimits: Partial<ValidationLimits> = {}
): ValidationResult {
  const limits: ValidationLimits = { ...DEFAULT_VALIDATION_LIMITS, ...customLimits };
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Document wrapper must be a non-null object."] };
  }

  const rawString = JSON.stringify(input);
  if (rawString.length > limits.maxJsonSizeBytes) {
    return {
      valid: false,
      errors: [`Document exceeds maximum payload size of ${limits.maxJsonSizeBytes} bytes.`],
    };
  }

  const wrapper = input as Record<string, any>;

  if (wrapper.schemaVersion !== 2) {
    errors.push(`Unsupported or missing schemaVersion: expected 2, received ${wrapper.schemaVersion}.`);
  }

  if (!wrapper.doc || typeof wrapper.doc !== "object" || wrapper.doc.type !== "doc") {
    errors.push(`Document wrapper must contain a valid root "doc" node with type="doc".`);
    return { valid: false, errors };
  }

  if (!Array.isArray(wrapper.doc.content)) {
    errors.push(`Root "doc" node must contain a "content" array.`);
    return { valid: false, errors };
  }

  let totalNodeCount = 1;
  let totalTextLength = 0;

  function traverseNode(node: any, depth: number): void {
    totalNodeCount++;
    if (depth > limits.maxNestingDepth) {
      errors.push(`Nesting depth of ${depth} exceeds maximum allowed limit of ${limits.maxNestingDepth}.`);
      return;
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push("Invalid node structure: node must be an object.");
      return;
    }

    const { type, attrs, content, marks, text } = node;

    if (!type || typeof type !== "string" || !ALLOWED_NODE_TYPES_V2.has(type)) {
      errors.push(`Disallowed or unknown node type: "${type}".`);
      return;
    }

    if (type === "editorialImage") {
      if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
        errors.push("editorialImage node requires an attrs object.");
      } else {
        validateEditorialImageAttributesV2(attrs, errors);
      }

      if (content && content.length > 0) {
        errors.push("editorialImage node cannot have children content.");
      }
      return;
    }

    if (attrs !== undefined) {
      if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) {
        errors.push(`Node "${type}" attrs must be a non-null object.`);
      } else {
        validateNodeAttributes(type, attrs, errors);
      }
    }

    if (type === "heading") {
      if (!attrs || typeof attrs.level !== "number" || ![2, 3, 4].includes(attrs.level)) {
        errors.push("Heading level must be an integer: 2, 3, or 4.");
      }
    }

    if (type === "orderedList" && attrs && attrs.start !== undefined) {
      if (typeof attrs.start !== "number" || attrs.start < 0 || !Number.isInteger(attrs.start)) {
        errors.push("OrderedList start attribute must be a non-negative integer.");
      }
    }

    if (type === "text") {
      if (typeof text !== "string") {
        errors.push('Text node must contain a string "text" property.');
      } else {
        totalTextLength += text.length;
      }

      if (marks !== undefined) {
        if (!Array.isArray(marks)) {
          errors.push('Text node "marks" property must be an array.');
        } else {
          validateMarks(marks, errors);
        }
      }
    }

    if (type === "hardBreak") {
      if (content && content.length > 0) {
        errors.push("hardBreak node cannot have children content.");
      }
    }

    if (type === "horizontalRule") {
      if (content && content.length > 0) {
        errors.push("horizontalRule node cannot have children content.");
      }
    }

    if (content !== undefined) {
      if (!Array.isArray(content)) {
        errors.push(`Node "${type}" content must be an array.`);
      } else {
        for (const child of content) {
          traverseNode(child, depth + 1);
        }
      }
    }
  }

  for (const childNode of wrapper.doc.content) {
    traverseNode(childNode, 1);
  }

  if (totalNodeCount > limits.maxNodeCount) {
    errors.push(`Total node count (${totalNodeCount}) exceeds maximum allowed limit of ${limits.maxNodeCount}.`);
  }

  if (totalTextLength > limits.maxTextLength) {
    errors.push(`Total text length (${totalTextLength}) exceeds maximum allowed limit of ${limits.maxTextLength}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateEditorialImageAttributesV2(attrs: Record<string, any>, errors: string[]): void {
  const allowedAttrKeys = new Set([
    "assetId",
    "altAr",
    "width",
    "layout",
    "altEn",
    "captionAr",
    "captionEn",
  ]);

  for (const key of Object.keys(attrs)) {
    if (!allowedAttrKeys.has(key)) {
      errors.push(`Disallowed or unknown attribute "${key}" on editorialImage node.`);
    }
  }

  if (!attrs.assetId || typeof attrs.assetId !== "string" || !SAFE_ASSET_ID_REGEX.test(attrs.assetId)) {
    errors.push("editorialImage assetId must be a non-empty path-safe string (1-128 chars).");
  }

  if (
    !attrs.altAr ||
    typeof attrs.altAr !== "string" ||
    attrs.altAr.trim().length === 0 ||
    attrs.altAr.length > 500
  ) {
    errors.push("editorialImage altAr must be a non-empty string up to 500 chars.");
  }

  if (!attrs.width || typeof attrs.width !== "string" || !ALLOWED_WIDTHS_V2.has(attrs.width)) {
    errors.push("editorialImage width must be one of: 25%, 50%, 75%, 100%.");
  }

  if (!attrs.layout || typeof attrs.layout !== "string" || !ALLOWED_LAYOUTS_V2.has(attrs.layout)) {
    errors.push("editorialImage layout must be one of: float-start, float-end, block-center, block-full.");
  }

  if (attrs.altEn !== undefined) {
    if (typeof attrs.altEn !== "string" || attrs.altEn.length > 500) {
      errors.push("editorialImage altEn must be a string up to 500 chars.");
    }
  }

  if (attrs.captionAr !== undefined) {
    if (typeof attrs.captionAr !== "string" || attrs.captionAr.length > 1000) {
      errors.push("editorialImage captionAr must be a string up to 1000 chars.");
    }
  }

  if (attrs.captionEn !== undefined) {
    if (typeof attrs.captionEn !== "string" || attrs.captionEn.length > 1000) {
      errors.push("editorialImage captionEn must be a string up to 1000 chars.");
    }
  }
}

