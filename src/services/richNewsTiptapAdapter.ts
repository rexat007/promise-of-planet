import type { RichNewsDocumentWrapper, RichNewsDocumentWrapperV2, TextDirection } from "../types/richNewsDocument";
import {
  validateRichNewsDocument,
  validateRichNewsDocumentV2,
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

/* ==========================================
 * Opt-In Schema Version 2 Adapter Functions
 * ========================================== */

/**
 * Recursively normalizes Tiptap JSON node elements for opt-in V2 contract rules.
 * Immutably clones node objects.
 * Omits dir, textAlign, link class/title when null.
 * For editorialImage nodes, omits optional attributes (altEn, captionAr, captionEn) ONLY when strictly null.
 * Unwanted attributes (such as src, publicUrl, downloadUrl, storagePath) are NOT deleted so the V2 validator rejects them.
 */
function normalizeTiptapNodeV2(node: any): any {
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
    if (normalized.type === "editorialImage") {
      if (attrs.altEn === null) delete attrs.altEn;
      if (attrs.captionAr === null) delete attrs.captionAr;
      if (attrs.captionEn === null) delete attrs.captionEn;
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
    normalized.content = normalized.content.map(normalizeTiptapNodeV2);
  }

  return normalized;
}

/**
 * Converts a native Tiptap JSON document into an opt-in schemaVersion 2 RichNewsDocumentWrapperV2.
 * Normalizes Tiptap default null attributes immutably and enforces strict V2 validation.
 * Preserves paragraph structure, headings, lists, text marks, and editorialImage nodes.
 * Throws TIPTAP_ADAPTER_ERROR if unsupported or invalid elements exist.
 */
export function tiptapJsonToRichDocumentV2(tiptapJson: TiptapDocJson): RichNewsDocumentWrapperV2 {
  if (!tiptapJson || typeof tiptapJson !== "object" || tiptapJson.type !== "doc") {
    throw new Error('TIPTAP_ADAPTER_ERROR: Invalid Tiptap document: root must be an object with type="doc".');
  }

  const rawContent = Array.isArray(tiptapJson.content) ? tiptapJson.content : [];
  const normalizedContent = rawContent.map(normalizeTiptapNodeV2);

  const wrapper: RichNewsDocumentWrapperV2 = {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: normalizedContent,
    },
  };

  const validation = validateRichNewsDocumentV2(wrapper);
  if (!validation.valid) {
    throw new Error(`TIPTAP_ADAPTER_ERROR: Document contains disallowed elements: ${validation.errors.join("; ")}`);
  }

  return wrapper;
}

/**
 * Converts a RichNewsDocumentWrapperV2 back into a native Tiptap JSON document.
 * Enforces schemaVersion 2 validation before extraction.
 * Returns an independent JSON clone without shared mutable references.
 */
export function richDocumentV2ToTiptapJson(wrapper: RichNewsDocumentWrapperV2): TiptapDocJson {
  const validation = validateRichNewsDocumentV2(wrapper);
  if (!validation.valid) {
    throw new Error(`TIPTAP_ADAPTER_ERROR: Invalid RichNewsDocumentWrapperV2: ${validation.errors.join("; ")}`);
  }
  return JSON.parse(JSON.stringify(wrapper.doc));
}

