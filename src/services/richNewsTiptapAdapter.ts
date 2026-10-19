import type { RichNewsDocumentWrapper, TextDirection } from "../types/richNewsDocument";
import {
  validateRichNewsDocument,
  convertPlainTextToRichDocument,
  extractPlainTextFromRichDocument,
} from "./richNewsDocumentContract";

export interface TiptapDocJson {
  type: "doc";
  content?: any[];
  [key: string]: any;
}

/**
 * Recursively normalizes Tiptap JSON node elements to fit strict E1-C contract rules:
 * - Omits `dir` attribute when its value is strictly null.
 * - Omits `textAlign` attribute when its value is strictly null.
 * - Omits `class` attribute on link marks when its value is strictly null.
 * - Omits `title` attribute on link marks when its value is strictly null.
 *
 * Immutably clones node objects without mutating the input object.
 * Non-null class, title, or string "null" values are preserved so the contract validator can reject them.
 */
function normalizeTiptapNode(node: any): any {
  if (!node || typeof node !== "object") return node;

  const normalized: any = { ...node };

  if (normalized.attrs && typeof normalized.attrs === "object") {
    const attrs = { ...normalized.attrs };
    if (attrs.dir === null) {
      delete attrs.dir;
    }
    if (attrs.textAlign === null) {
      delete attrs.textAlign;
    }
    normalized.attrs = attrs;
  }

  if (Array.isArray(normalized.marks)) {
    normalized.marks = normalized.marks.map((mark: any) => {
      if (!mark || typeof mark !== "object") return mark;
      if (mark.type === "link" && mark.attrs && typeof mark.attrs === "object") {
        const linkAttrs = { ...mark.attrs };
        if (linkAttrs.class === null) {
          delete linkAttrs.class;
        }
        if (linkAttrs.title === null) {
          delete linkAttrs.title;
        }
        return {
          ...mark,
          attrs: linkAttrs,
        };
      }
      return mark;
    });
  }

  if (Array.isArray(normalized.content)) {
    normalized.content = normalized.content.map(normalizeTiptapNode);
  }

  return normalized;
}

/**
 * Converts a native Tiptap JSON document ({ type: "doc", content: [...] }) into an E1-C RichNewsDocumentWrapper.
 * Normalizes Tiptap default null attributes immutably and enforces strict validation. Throws TIPTAP_ADAPTER_ERROR if unsupported elements exist.
 */
export function tiptapJsonToRichDocument(tiptapJson: TiptapDocJson): RichNewsDocumentWrapper {
  if (!tiptapJson || typeof tiptapJson !== "object" || tiptapJson.type !== "doc") {
    throw new Error("TIPTAP_ADAPTER_ERROR: Invalid Tiptap document: root must be an object with type=\"doc\".");
  }

  const rawContent = Array.isArray(tiptapJson.content) ? tiptapJson.content : [];
  const normalizedContent = rawContent.map(normalizeTiptapNode);

  const wrapper: RichNewsDocumentWrapper = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: normalizedContent,
    },
  };

  const validation = validateRichNewsDocument(wrapper);
  if (!validation.valid) {
    throw new Error(`TIPTAP_ADAPTER_ERROR: Document contains disallowed elements: ${validation.errors.join("; ")}`);
  }

  return wrapper;
}

/**
 * Converts an E1-C RichNewsDocumentWrapper back into native Tiptap JSON document.
 * Enforces schema validation before extraction.
 */
export function richDocumentToTiptapJson(wrapper: RichNewsDocumentWrapper): TiptapDocJson {
  const validation = validateRichNewsDocument(wrapper);
  if (!validation.valid) {
    throw new Error(`TIPTAP_ADAPTER_ERROR: Invalid RichNewsDocumentWrapper: ${validation.errors.join("; ")}`);
  }
  return wrapper.doc;
}

/**
 * Converts legacy plain-text article content directly into native Tiptap JSON document.
 */
export function plainTextToTiptapJson(text: string, defaultDir: TextDirection = "rtl"): TiptapDocJson {
  const wrapper = convertPlainTextToRichDocument(text, defaultDir);
  return wrapper.doc;
}

/**
 * Extracts clean plain-text string directly from a native Tiptap JSON document.
 */
export function tiptapJsonToPlainText(tiptapJson: TiptapDocJson): string {
  const wrapper = tiptapJsonToRichDocument(tiptapJson);
  return extractPlainTextFromRichDocument(wrapper);
}
