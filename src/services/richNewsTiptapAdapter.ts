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

function containsEditorialImageNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }

  const candidate = node as { type?: unknown; content?: unknown };
  if (candidate.type === "editorialImage") {
    return true;
  }

  if (Array.isArray(candidate.content)) {
    return candidate.content.some(containsEditorialImageNode);
  }

  return false;
}

function assertNoNestedEditorialImageNodes(docNode: unknown): void {
  if (!docNode || typeof docNode !== "object" || Array.isArray(docNode)) {
    return;
  }

  const rootContent = (docNode as { content?: unknown }).content;
  if (!Array.isArray(rootContent)) {
    return;
  }

  function inspectChild(node: unknown, parentType: string): void {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }

    const candidate = node as { type?: unknown; content?: unknown };
    if (candidate.type === "editorialImage") {
      throw new Error(
        `TIPTAP_ADAPTER_ERROR: editorialImage must be a top-level block node; cannot be nested inside "${parentType}".`
      );
    }

    if (Array.isArray(candidate.content)) {
      const nextParent = typeof candidate.type === "string" ? candidate.type : parentType;
      for (const grandChild of candidate.content) {
        inspectChild(grandChild, nextParent);
      }
    }
  }

  for (const topLevelBlock of rootContent) {
    if (!topLevelBlock || typeof topLevelBlock !== "object" || Array.isArray(topLevelBlock)) {
      continue;
    }
    const blockCandidate = topLevelBlock as { type?: unknown; content?: unknown };
    if (blockCandidate.type !== "editorialImage" && Array.isArray(blockCandidate.content)) {
      const parentType = typeof blockCandidate.type === "string" ? blockCandidate.type : "block";
      for (const child of blockCandidate.content) {
        inspectChild(child, parentType);
      }
    }
  }
}

/**
 * Converts a validated V1 or V2 RichNewsDocumentWrapper into a native Tiptap JSON document.
 * Dispatches strictly by schemaVersion (1 -> V1 adapter, 2 -> V2 adapter), fails closed for
 * missing or unknown versions, and returns an independent clone that never mutates the input.
 */
export function richDocumentToTiptapJsonByVersion(
  wrapper: RichNewsDocumentWrapper | RichNewsDocumentWrapperV2
): TiptapDocJson {
  if (!wrapper || typeof wrapper !== "object" || Array.isArray(wrapper)) {
    throw new Error("TIPTAP_ADAPTER_ERROR: Invalid RichNewsDocumentWrapper: root must be a plain object.");
  }

  if (wrapper.schemaVersion === 1) {
    const doc = richDocumentToTiptapJson(wrapper);
    return JSON.parse(JSON.stringify(doc)) as TiptapDocJson;
  }

  if (wrapper.schemaVersion === 2) {
    assertNoNestedEditorialImageNodes(wrapper.doc);
    return richDocumentV2ToTiptapJson(wrapper);
  }

  const unknownVersion = (wrapper as { schemaVersion?: unknown }).schemaVersion;
  throw new Error(
    `TIPTAP_ADAPTER_ERROR: Unsupported or missing RichNewsDocument schemaVersion: expected 1 or 2, received ${String(unknownVersion)}.`
  );
}

/**
 * Converts a native Tiptap JSON document into a canonical RichNewsDocumentWrapper (V1 or V2).
 * Produces schemaVersion 1 for text-only documents by default, upgrades to schemaVersion 2 when
 * editorialImage nodes are present or minimumSchemaVersion === 2 is explicitly requested, and
 * fails closed without silently stripping invalid or disallowed attributes.
 */
export function tiptapJsonToRichDocumentByVersion(
  tiptapJson: TiptapDocJson,
  minimumSchemaVersion?: 1 | 2
): RichNewsDocumentWrapper | RichNewsDocumentWrapperV2 {
  if (
    minimumSchemaVersion !== undefined &&
    minimumSchemaVersion !== 1 &&
    minimumSchemaVersion !== 2
  ) {
    throw new Error(
      `TIPTAP_ADAPTER_ERROR: Unsupported minimumSchemaVersion: expected 1 or 2, received ${String(minimumSchemaVersion)}.`
    );
  }

  if (!tiptapJson || typeof tiptapJson !== "object" || Array.isArray(tiptapJson) || tiptapJson.type !== "doc") {
    throw new Error('TIPTAP_ADAPTER_ERROR: Invalid Tiptap document: root must be an object with type="doc".');
  }

  if (minimumSchemaVersion === 2 || containsEditorialImageNode(tiptapJson)) {
    assertNoNestedEditorialImageNodes(tiptapJson);
    return tiptapJsonToRichDocumentV2(tiptapJson);
  }

  return tiptapJsonToRichDocument(tiptapJson);
}
