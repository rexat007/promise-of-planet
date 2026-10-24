import { useEffect, useRef, type ReactNode } from "react";
import { Editor } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/react";
import { getE1CTiptapExtensions } from "./tiptapExtensions";
import {
  EditorialImageLocaleContext,
  EditorialImagePreviewContext,
  ALLOWED_EDITORIAL_IMAGE_LAYOUTS,
  ALLOWED_EDITORIAL_IMAGE_WIDTHS,
  createEditorialImageNodeActions,
  validateCanonicalEditorialImageAttrs,
  type EditorialImageLocaleContextValue,
  type EditorialImageLayoutV2,
  type EditorialImageWidthV2,
  type EditorialImageNodeActions,
} from "./editorialImageExtension";
import {
  richDocumentToTiptapJsonByVersion,
  tiptapJsonToRichDocumentByVersion,
  type TiptapDocJson,
} from "../../../services/richNewsTiptapAdapter";
import type {
  EditorialImageNodeAttrsV2,
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../../../types/richNewsDocument";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Heading3,
  Heading4,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Image as ImageIcon,
  Undo,
  Redo,
} from "lucide-react";

export type RichTextEditorDocumentValue =
  | RichNewsDocumentWrapper
  | RichNewsDocumentWrapperV2;

export type EditorialImageInsertionFailureReason =
  | "EDITOR_UNAVAILABLE"
  | "EDITOR_READ_ONLY"
  | "ALREADY_CONSUMED"
  | "INVALID_IMAGE_ATTRS"
  | "STALE_SELECTION"
  | "DOCUMENT_UPDATE_REJECTED";

export interface EditorialImageSelectionSnapshot {
  readonly from: number;
  readonly to: number;
  readonly topLevelInsertPos: number;
  readonly targetBlockIndex: number;
  readonly anchorBlockIndex: number;
  readonly targetBlockType: string | null;
  readonly replaceEmptyBlock: boolean;
  readonly replaceRange: { readonly from: number; readonly to: number } | null;
  readonly docFingerprint: string;
  readonly docChildCount: number;
  readonly docContentSize: number;
}

export type EditorialImageInsertionResult =
  | {
      readonly ok: true;
      readonly insertedAttrs: EditorialImageNodeAttrsV2;
      readonly wrapper: RichNewsDocumentWrapperV2;
    }
  | {
      readonly ok: false;
      readonly reasonCode: EditorialImageInsertionFailureReason;
      readonly errors: readonly string[];
      readonly error: string;
    };

export interface EditorialImageInsertionRequest {
  readonly requestId: string;
  readonly editorLang: "ar" | "en";
  readonly editorDir: "rtl" | "ltr";
  readonly selectionSnapshot: EditorialImageSelectionSnapshot;
  insertCanonicalImage: (
    candidateAttrs: unknown
  ) => EditorialImageInsertionResult;
  isConsumed: () => boolean;
  restoreFocus: () => boolean;
}

export interface RichTextEditorProps {
  value: RichTextEditorDocumentValue;
  onChange: (value: RichTextEditorDocumentValue) => void;
  readOnly?: boolean;
  lang?: "ar" | "en";
  dir?: "rtl" | "ltr";
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  getPreviewUrl?: (assetId: string) => string | undefined;
  onRequestInsertInlineImage?: (
    request: EditorialImageInsertionRequest
  ) => void;
}

/**
 * Resolves the Arabic RTL or English LTR locale for a specific RichTextEditor instance
 * based on explicit instance props or the document blocks' directional attributes,
 * never relying on global UI language alone.
 */
export function resolveEditorInstanceLocale(
  value: unknown,
  explicit?: {
    lang?: "ar" | "en";
    dir?: "rtl" | "ltr";
  },
  fallback?: EditorialImageLocaleContextValue
): EditorialImageLocaleContextValue {
  if (explicit?.dir === "ltr" || explicit?.lang === "en") {
    return {
      lang: explicit.lang ?? "en",
      dir: explicit.dir ?? "ltr",
    };
  }
  if (explicit?.dir === "rtl" || explicit?.lang === "ar") {
    return {
      lang: explicit.lang ?? "ar",
      dir: explicit.dir ?? "rtl",
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const doc = (value as { doc?: { content?: unknown[] } }).doc;
    if (doc && Array.isArray(doc.content)) {
      for (const block of doc.content) {
        if (!block || typeof block !== "object") continue;
        const attrs = (block as { attrs?: Record<string, unknown> }).attrs;
        if (!attrs || typeof attrs !== "object") continue;
        if (attrs.dir === "ltr") {
          return { lang: "en", dir: "ltr" };
        }
        if (attrs.dir === "rtl") {
          return { lang: "ar", dir: "rtl" };
        }
        if (attrs.textAlign === "left") {
          return { lang: "en", dir: "ltr" };
        }
        if (attrs.textAlign === "right") {
          return { lang: "ar", dir: "rtl" };
        }
      }
    }
  }

  if (fallback) {
    return fallback;
  }

  return { lang: "ar", dir: "rtl" };
}

export interface RichTextEditorDocumentSessionOptions {
  initialValue: RichTextEditorDocumentValue;
  onChange: (value: RichTextEditorDocumentValue) => void;
  lang?: "ar" | "en";
  dir?: "rtl" | "ltr";
  readOnly?: boolean;
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  getPreviewUrl?: (assetId: string) => string | undefined;
  onRequestInsertInlineImage?: (
    request: EditorialImageInsertionRequest
  ) => void;
}

export interface EditorUpdateResult {
  ok: boolean;
  wrapper?: RichTextEditorDocumentValue;
  error?: Error;
  preservedTiptapJson?: TiptapDocJson;
  minimumSchemaVersion: 1 | 2;
  locale: EditorialImageLocaleContextValue;
}

export interface SyncExternalValueResult {
  ok: boolean;
  synced: boolean;
  tiptapJson?: TiptapDocJson;
  error?: Error;
  preservedTiptapJson?: TiptapDocJson;
  minimumSchemaVersion: 1 | 2;
  locale: EditorialImageLocaleContextValue;
}

export interface RichTextEditorDocumentSession {
  getInitialTiptapJson: () => TiptapDocJson;
  getLastValidTiptapJson: () => TiptapDocJson;
  getMinimumSchemaVersion: () => 1 | 2;
  getLocale: () => EditorialImageLocaleContextValue;
  setOnChange: (fn: (value: RichTextEditorDocumentValue) => void) => void;
  setExplicitLocale: (explicit?: { lang?: "ar" | "en"; dir?: "rtl" | "ltr" }) => void;
  handleEditorUpdate: (currentTiptapJson: TiptapDocJson) => EditorUpdateResult;
  syncExternalValue: (
    nextValue: RichTextEditorDocumentValue,
    editorInstance?: {
      getJSON: () => any;
      commands?: {
        setContent: (content: any, options?: { emitUpdate?: boolean }) => any;
      };
      view?: {
        dom?: {
          setAttribute?: (name: string, value: string) => void;
        };
      };
      isDestroyed?: boolean;
    } | null
  ) => SyncExternalValueResult;
}

function normalizeTiptapNodeDefaultNullAttrs(node: any): any {
  if (!node || typeof node !== "object") return node;
  const clone: any = { ...node };
  if (
    clone.type === "orderedList" &&
    clone.attrs &&
    typeof clone.attrs === "object" &&
    clone.attrs.type === null
  ) {
    const nextAttrs = { ...clone.attrs };
    delete nextAttrs.type;
    clone.attrs = nextAttrs;
  }
  if (Array.isArray(clone.content)) {
    clone.content = clone.content.map(normalizeTiptapNodeDefaultNullAttrs);
  }
  return clone;
}

function normalizeTiptapDocDefaultNullAttrs(docJson: TiptapDocJson): TiptapDocJson {
  if (!docJson || typeof docJson !== "object" || !Array.isArray(docJson.content)) {
    return docJson;
  }
  return {
    ...docJson,
    content: docJson.content.map(normalizeTiptapNodeDefaultNullAttrs),
  };
}

/**
 * Version-aware, fail-closed document session controller for RichTextEditor.
 * - Dispatches strictly by schemaVersion (1 or 2) via richDocumentToTiptapJsonByVersion.
 * - Preserves schemaVersion: 1 for V1 text-only documents.
 * - Preserves schemaVersion: 2 for V2 documents across the editing session, including when all images are deleted.
 * - Fails closed on malformed/unsupported documents without downgrading to V1 or overwriting existing editor content.
 */
export function createRichTextEditorDocumentSession(
  options: RichTextEditorDocumentSessionOptions
): RichTextEditorDocumentSession {
  const initialTiptapJson = richDocumentToTiptapJsonByVersion(options.initialValue);
  let lastValidTiptapJson: TiptapDocJson = JSON.parse(
    JSON.stringify(initialTiptapJson)
  );
  let minimumSchemaVersion: 1 | 2 =
    options.initialValue.schemaVersion === 2 ? 2 : 1;
  let explicitLocale: { lang?: "ar" | "en"; dir?: "rtl" | "ltr" } | undefined = {
    lang: options.lang,
    dir: options.dir,
  };
  let locale: EditorialImageLocaleContextValue = resolveEditorInstanceLocale(
    options.initialValue,
    explicitLocale
  );
  let currentOnChange = options.onChange;

  return {
    getInitialTiptapJson() {
      return JSON.parse(JSON.stringify(initialTiptapJson));
    },

    getLastValidTiptapJson() {
      return JSON.parse(JSON.stringify(lastValidTiptapJson));
    },

    getMinimumSchemaVersion() {
      return minimumSchemaVersion;
    },

    getLocale() {
      return locale;
    },

    setOnChange(fn) {
      currentOnChange = fn;
    },

    setExplicitLocale(nextExplicit) {
      explicitLocale = nextExplicit;
      if (nextExplicit?.dir || nextExplicit?.lang) {
        locale = resolveEditorInstanceLocale(undefined, nextExplicit, locale);
      }
    },

    handleEditorUpdate(currentTiptapJson: TiptapDocJson): EditorUpdateResult {
      try {
        const sanitizedJson = normalizeTiptapDocDefaultNullAttrs(currentTiptapJson);
        const nextWrapper = tiptapJsonToRichDocumentByVersion(
          sanitizedJson,
          minimumSchemaVersion
        );
        if (nextWrapper.schemaVersion === 2) {
          minimumSchemaVersion = 2;
        }
        locale = resolveEditorInstanceLocale(nextWrapper, explicitLocale, locale);
        lastValidTiptapJson = JSON.parse(JSON.stringify(sanitizedJson));
        currentOnChange(nextWrapper);
        return {
          ok: true,
          wrapper: nextWrapper,
          minimumSchemaVersion,
          locale,
        };
      } catch (err) {
        console.error("RichTextEditor: Failed to convert editor update", err);
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          preservedTiptapJson: JSON.parse(JSON.stringify(lastValidTiptapJson)),
          minimumSchemaVersion,
          locale,
        };
      }
    },

    syncExternalValue(nextValue, editorInstance): SyncExternalValueResult {
      try {
        const nextJson = richDocumentToTiptapJsonByVersion(nextValue);
        if (nextValue.schemaVersion === 2) {
          minimumSchemaVersion = 2;
        }
        locale = resolveEditorInstanceLocale(nextValue, explicitLocale, locale);
        lastValidTiptapJson = JSON.parse(JSON.stringify(nextJson));

        if (editorInstance && !isEditorInstanceDestroyed(editorInstance)) {
          const currentJson = editorInstance.getJSON();
          // Use stringification for deep content equality check to avoid infinite loops
          // or redundant setContent calls caused by reference inequality.
          if (JSON.stringify(currentJson) !== JSON.stringify(nextJson)) {
            editorInstance.commands?.setContent(nextJson, { emitUpdate: false });
          }
          const rawEditorView = (
            editorInstance as unknown as {
              editorView?: { dom?: { setAttribute?: (name: string, value: string) => void } } | null;
            }
          ).editorView;
          const domTarget =
            rawEditorView !== undefined
              ? rawEditorView?.dom
              : editorInstance.view?.dom;
          if (domTarget?.setAttribute) {
            domTarget.setAttribute("dir", locale.dir);
            domTarget.setAttribute("lang", locale.lang);
          }
        }

        return {
          ok: true,
          synced: true,
          tiptapJson: nextJson,
          minimumSchemaVersion,
          locale,
        };
      } catch (err) {
        console.error("RichTextEditor: Failed to sync external value", err);
        return {
          ok: false,
          synced: false,
          error: err instanceof Error ? err : new Error(String(err)),
          preservedTiptapJson: JSON.parse(JSON.stringify(lastValidTiptapJson)),
          minimumSchemaVersion,
          locale,
        };
      }
    },
  };
}

let insertionRequestCounter = 0;

function createNextInsertionRequestId(): string {
  insertionRequestCounter += 1;
  return `rte_img_req_${Date.now()}_${insertionRequestCounter}`;
}

/**
 * Checks whether a Tiptap Editor instance (either DOM-mounted or headless) has been destroyed.
 * In @tiptap/core v3, `editor.isDestroyed` returns `this.editorView?.isDestroyed ?? true`,
 * which evaluates to `true` when `editorView` is null on an unmounted headless `Editor`.
 * Checking `destroyed` and any mounted `editorView.isDestroyed` handles both environments accurately.
 */
export function isEditorInstanceDestroyed(editor: unknown): boolean {
  if (!editor || typeof editor !== "object") return true;
  const candidate = editor as {
    destroyed?: boolean;
    isDestroyed?: boolean;
    editorView?: { isDestroyed?: boolean } | null;
    schema?: unknown;
  };
  if (candidate.destroyed === true) return true;
  if ("schema" in candidate && candidate.schema === null) return true;
  if ("editorView" in candidate) {
    if (candidate.editorView && candidate.editorView.isDestroyed === true) {
      return true;
    }
    return false;
  }
  return Boolean(candidate.isDestroyed);
}

/**
 * Captures a deterministic, schema-safe top-level insertion snapshot from a ProseMirror/Tiptap editor.
 * - Resolves cursors inside paragraphs, headings, bullet lists, ordered lists, list items, and blockquotes
 *   to the top-level document boundary immediately after the containing top-level block ($to.after(1)).
 * - Preserves highlighted text ranges without deleting selected text.
 * - Replaces an empty top-level paragraph in-place at its verified [before(1), after(1)] root boundary.
 * - Supports explicit root boundaries ($to.depth === 0) at document start (0) or document end (doc.content.size).
 */
export function captureEditorialImageSelectionSnapshot(
  editor: Editor,
  explicitSelectionRange?: { readonly from: number; readonly to: number }
): EditorialImageSelectionSnapshot {
  const doc = editor.state.doc;
  const docContentSize = doc.content.size;
  const docChildCount = doc.childCount;
  const docFingerprint = JSON.stringify(editor.getJSON());

  const rawFrom = explicitSelectionRange
    ? explicitSelectionRange.from
    : editor.state.selection.from;
  const rawTo = explicitSelectionRange
    ? explicitSelectionRange.to
    : editor.state.selection.to;

  const from = Math.max(0, Math.min(rawFrom, docContentSize));
  const to = Math.max(from, Math.min(rawTo, docContentSize));

  if (docChildCount === 0) {
    return Object.freeze({
      from,
      to,
      topLevelInsertPos: 0,
      targetBlockIndex: 0,
      anchorBlockIndex: -1,
      targetBlockType: null,
      replaceEmptyBlock: false,
      replaceRange: null,
      docFingerprint,
      docChildCount: 0,
      docContentSize,
    });
  }

  const $to = doc.resolve(to);

  if ($to.depth === 0) {
    const boundaryIndex = $to.index(0);
    const anchorIdx =
      boundaryIndex < docChildCount
        ? boundaryIndex
        : Math.max(0, docChildCount - 1);
    const anchorNode = doc.maybeChild(anchorIdx);

    return Object.freeze({
      from,
      to,
      topLevelInsertPos: $to.pos,
      targetBlockIndex: boundaryIndex,
      anchorBlockIndex: anchorIdx,
      targetBlockType: anchorNode ? anchorNode.type.name : null,
      replaceEmptyBlock: false,
      replaceRange: null,
      docFingerprint,
      docChildCount,
      docContentSize,
    });
  }

  // $to.depth >= 1: cursor or selection end is inside a top-level block at depth 1
  const blockIndex = $to.index(0);
  const topBlock = $to.node(1);
  const blockBefore = $to.before(1);
  const blockAfter = $to.after(1);

  const isCollapsedInEmptyTopParagraph =
    from === to &&
    $to.depth === 1 &&
    topBlock.type.name === "paragraph" &&
    topBlock.content.size === 0;

  if (isCollapsedInEmptyTopParagraph) {
    return Object.freeze({
      from,
      to,
      topLevelInsertPos: blockBefore,
      targetBlockIndex: blockIndex,
      anchorBlockIndex: blockIndex,
      targetBlockType: "paragraph",
      replaceEmptyBlock: true,
      replaceRange: Object.freeze({ from: blockBefore, to: blockAfter }),
      docFingerprint,
      docChildCount,
      docContentSize,
    });
  }

  return Object.freeze({
    from,
    to,
    topLevelInsertPos: blockAfter,
    targetBlockIndex: blockIndex + 1,
    anchorBlockIndex: blockIndex,
    targetBlockType: topBlock.type.name,
    replaceEmptyBlock: false,
    replaceRange: null,
    docFingerprint,
    docChildCount,
    docContentSize,
  });
}

export interface CreateEditorialImageInsertionRequestOptions {
  readonly editor: Editor | null | undefined;
  readonly session: RichTextEditorDocumentSession;
  readonly isReadOnly?: () => boolean;
  readonly isInstanceDestroyed?: () => boolean;
  readonly getCurrentEditor?: () => Editor | null | undefined;
  readonly explicitSelectionRange?: { readonly from: number; readonly to: number };
  readonly requestId?: string;
}

/**
 * Shared production insertion request factory used by both headless and React RichTextEditor paths.
 * Binds the request to the specific editor instance, language/direction, document fingerprint,
 * and verified top-level block boundary with synchronous one-shot consumption semantics.
 */
export function createEditorialImageInsertionRequest(
  options: CreateEditorialImageInsertionRequestOptions
): EditorialImageInsertionRequest {
  const capturedEditor = options.editor ?? null;
  const session = options.session;
  const capturedLocale = session.getLocale();
  const editorLang = capturedLocale.lang;
  const editorDir = capturedLocale.dir;
  const requestId = options.requestId || createNextInsertionRequestId();

  const selectionSnapshot: EditorialImageSelectionSnapshot =
    capturedEditor && !isEditorInstanceDestroyed(capturedEditor)
      ? captureEditorialImageSelectionSnapshot(
          capturedEditor,
          options.explicitSelectionRange
        )
      : Object.freeze({
          from: 0,
          to: 0,
          topLevelInsertPos: 0,
          targetBlockIndex: 0,
          anchorBlockIndex: -1,
          targetBlockType: null,
          replaceEmptyBlock: false,
          replaceRange: null,
          docFingerprint: "",
          docChildCount: 0,
          docContentSize: 0,
        });

  let consumed = false;

  return {
    requestId,
    editorLang,
    editorDir,
    selectionSnapshot,

    isConsumed() {
      return consumed;
    },

    restoreFocus() {
      if (
        !capturedEditor ||
        isEditorInstanceDestroyed(capturedEditor) ||
        options.isInstanceDestroyed?.()
      ) {
        return false;
      }
      if (!capturedEditor.isEditable || options.isReadOnly?.()) {
        return false;
      }
      try {
        capturedEditor.commands.focus();
        return true;
      } catch {
        return false;
      }
    },

    insertCanonicalImage(candidateAttrs: unknown): EditorialImageInsertionResult {
      if (consumed) {
        const msg =
          "ALREADY_CONSUMED: This inline editorial image insertion request has already been consumed.";
        return {
          ok: false,
          reasonCode: "ALREADY_CONSUMED",
          errors: [msg],
          error: msg,
        };
      }

      const activeEditorRef = options.getCurrentEditor
        ? options.getCurrentEditor()
        : capturedEditor;

      if (
        options.isInstanceDestroyed?.() ||
        !capturedEditor ||
        !activeEditorRef ||
        isEditorInstanceDestroyed(activeEditorRef)
      ) {
        const msg =
          "EDITOR_UNAVAILABLE: Target RichTextEditor instance is unavailable or has been destroyed.";
        return {
          ok: false,
          reasonCode: "EDITOR_UNAVAILABLE",
          errors: [msg],
          error: msg,
        };
      }

      if (
        activeEditorRef !== capturedEditor ||
        isEditorInstanceDestroyed(capturedEditor)
      ) {
        const msg =
          "STALE_SELECTION: Editor document state was replaced after the insertion request was created.";
        return {
          ok: false,
          reasonCode: "STALE_SELECTION",
          errors: [msg],
          error: msg,
        };
      }

      if (!capturedEditor.isEditable || options.isReadOnly?.()) {
        const msg =
          "EDITOR_READ_ONLY: Target RichTextEditor instance is in read-only mode.";
        return {
          ok: false,
          reasonCode: "EDITOR_READ_ONLY",
          errors: [msg],
          error: msg,
        };
      }

      // Verify document context and top-level boundary have not become stale
      const currentLocale = session.getLocale();
      const currentDoc = capturedEditor.state.doc;
      const currentFingerprint = JSON.stringify(capturedEditor.getJSON());

      if (
        currentLocale.lang !== editorLang ||
        currentLocale.dir !== editorDir ||
        currentFingerprint !== selectionSnapshot.docFingerprint ||
        currentDoc.childCount !== selectionSnapshot.docChildCount ||
        currentDoc.content.size !== selectionSnapshot.docContentSize
      ) {
        const msg =
          "STALE_SELECTION: Document content or locale changed after selection capture; refusing to guess insertion position.";
        return {
          ok: false,
          reasonCode: "STALE_SELECTION",
          errors: [msg],
          error: msg,
        };
      }

      if (selectionSnapshot.replaceEmptyBlock) {
        const range = selectionSnapshot.replaceRange;
        if (
          !range ||
          range.from < 0 ||
          range.to > currentDoc.content.size ||
          range.from >= range.to
        ) {
          const msg =
            "STALE_SELECTION: Captured empty-block replacement range is no longer valid.";
          return {
            ok: false,
            reasonCode: "STALE_SELECTION",
            errors: [msg],
            error: msg,
          };
        }
        const $start = currentDoc.resolve(range.from);
        const $end = currentDoc.resolve(range.to);
        const targetNode = currentDoc.maybeChild(
          selectionSnapshot.anchorBlockIndex
        );
        if (
          $start.depth !== 0 ||
          $end.depth !== 0 ||
          !targetNode ||
          targetNode.type.name !== "paragraph" ||
          targetNode.content.size !== 0
        ) {
          const msg =
            "STALE_SELECTION: Target empty paragraph boundary is no longer valid.";
          return {
            ok: false,
            reasonCode: "STALE_SELECTION",
            errors: [msg],
            error: msg,
          };
        }
      } else {
        const insertPos = selectionSnapshot.topLevelInsertPos;
        if (insertPos < 0 || insertPos > currentDoc.content.size) {
          const msg =
            "STALE_SELECTION: Captured top-level insertion position is out of document bounds.";
          return {
            ok: false,
            reasonCode: "STALE_SELECTION",
            errors: [msg],
            error: msg,
          };
        }
        const $insert = currentDoc.resolve(insertPos);
        if (
          $insert.depth !== 0 ||
          $insert.index(0) !== selectionSnapshot.targetBlockIndex
        ) {
          const msg =
            "STALE_SELECTION: Captured position is not a valid top-level block boundary.";
          return {
            ok: false,
            reasonCode: "STALE_SELECTION",
            errors: [msg],
            error: msg,
          };
        }
        if (selectionSnapshot.anchorBlockIndex >= 0) {
          const anchorNode = currentDoc.maybeChild(
            selectionSnapshot.anchorBlockIndex
          );
          if (
            !anchorNode ||
            anchorNode.type.name !== selectionSnapshot.targetBlockType
          ) {
            const msg =
              "STALE_SELECTION: Anchor top-level block changed since selection capture.";
            return {
              ok: false,
              reasonCode: "STALE_SELECTION",
              errors: [msg],
              error: msg,
            };
          }
        }
      }

      // Validate candidate attributes against canonical V2 contract
      // (Checked before setting consumed=true so caller can correct invalid input on the same request)
      const attrValidation = validateCanonicalEditorialImageAttrs(candidateAttrs);
      if (!attrValidation.valid || !attrValidation.attrs) {
        const msg = `INVALID_IMAGE_ATTRS: ${attrValidation.errors.join("; ")}`;
        return {
          ok: false,
          reasonCode: "INVALID_IMAGE_ATTRS",
          errors: attrValidation.errors,
          error: msg,
        };
      }

      const editorialImageNodeType =
        capturedEditor.state.schema.nodes.editorialImage;
      if (!editorialImageNodeType) {
        const msg =
          'DOCUMENT_UPDATE_REJECTED: Schema is missing "editorialImage" node definition.';
        return {
          ok: false,
          reasonCode: "DOCUMENT_UPDATE_REJECTED",
          errors: [msg],
          error: msg,
        };
      }

      try {
        const imageNode = editorialImageNodeType.createChecked(
          attrValidation.attrs
        );
        const tr =
          selectionSnapshot.replaceEmptyBlock && selectionSnapshot.replaceRange
            ? capturedEditor.state.tr.replaceWith(
                selectionSnapshot.replaceRange.from,
                selectionSnapshot.replaceRange.to,
                imageNode
              )
            : capturedEditor.state.tr.insert(
                selectionSnapshot.topLevelInsertPos,
                imageNode
              );

        const candidateDocJson = normalizeTiptapDocDefaultNullAttrs(
          tr.doc.toJSON() as TiptapDocJson
        );
        const validatedWrapper = tiptapJsonToRichDocumentByVersion(
          candidateDocJson,
          2
        );
        if (validatedWrapper.schemaVersion !== 2) {
          const msg =
            "DOCUMENT_UPDATE_REJECTED: Inserted editorialImage document did not promote to schemaVersion 2.";
          return {
            ok: false,
            reasonCode: "DOCUMENT_UPDATE_REJECTED",
            errors: [msg],
            error: msg,
          };
        }

        // Synchronously mark request consumed before dispatching ProseMirror transaction
        consumed = true;

        const preservedBeforeDispatch = session.getLastValidTiptapJson();
        capturedEditor.view.dispatch(tr);

        if (session.getMinimumSchemaVersion() !== 2) {
          const updateResult = session.handleEditorUpdate(
            capturedEditor.getJSON() as TiptapDocJson
          );
          if (!updateResult.ok || updateResult.wrapper?.schemaVersion !== 2) {
            consumed = false;
            capturedEditor.commands.setContent(preservedBeforeDispatch, {
              emitUpdate: false,
            });
            const errMsg =
              updateResult.error?.message ||
              "DOCUMENT_UPDATE_REJECTED: Session rejected document update after image insertion.";
            return {
              ok: false,
              reasonCode: "DOCUMENT_UPDATE_REJECTED",
              errors: [errMsg],
              error: errMsg,
            };
          }
        }

        return {
          ok: true,
          insertedAttrs: attrValidation.attrs,
          wrapper: validatedWrapper,
        };
      } catch (err) {
        const msg =
          err instanceof Error
            ? `DOCUMENT_UPDATE_REJECTED: ${err.message}`
            : `DOCUMENT_UPDATE_REJECTED: ${String(err)}`;
        return {
          ok: false,
          reasonCode: "DOCUMENT_UPDATE_REJECTED",
          errors: [msg],
          error: msg,
        };
      }
    },
  };
}

export interface ProductionRichTextEditorHarness {
  getEditor: () => Editor;
  session: RichTextEditorDocumentSession;
  getDocumentWrapper: () => RichTextEditorDocumentValue;
  requestInsertInlineImage: (
    explicitSelectionRange?: { readonly from: number; readonly to: number }
  ) => EditorialImageInsertionRequest;
  createImageNodeActions: (imageOccurrenceIndex?: number) => EditorialImageNodeActions;
  updateImageAttributesAt: (
    imageOccurrenceIndex: number,
    attrsPatch: Record<string, unknown>
  ) => EditorUpdateResult;
  deleteImageNodeAt: (imageOccurrenceIndex?: number) => EditorUpdateResult;
  destroy: () => void;
}

/**
 * Creates a headless production Tiptap Editor instance wired with `getE1CTiptapExtensions`
 * and `createRichTextEditorDocumentSession` for deterministic V1/V2 integration verification.
 */
export function createProductionRichTextEditorInstance(
  options: RichTextEditorDocumentSessionOptions
): ProductionRichTextEditorHarness {
  const session = createRichTextEditorDocumentSession(options);
  const extensions = getE1CTiptapExtensions({
    previewUrlsByAssetId: options.previewUrlsByAssetId,
    getPreviewUrl: options.getPreviewUrl,
  });

  let isHarnessDestroyed = false;
  let activeEditor = new Editor({
    extensions,
    content: session.getInitialTiptapJson(),
    editable: !options.readOnly,
    editorProps: {
      attributes: {
        dir: session.getLocale().dir,
        lang: session.getLocale().lang,
      },
    },
    onUpdate: ({ editor }) => {
      session.handleEditorUpdate(editor.getJSON() as TiptapDocJson);
    },
  });

  function findEditorialImageBlockIndex(
    content: any[],
    occurrenceIndex: number
  ): number {
    let seen = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i]?.type === "editorialImage") {
        if (seen === occurrenceIndex) return i;
        seen++;
      }
    }
    return -1;
  }

  function applyCandidateDocJson(candidateDocJson: TiptapDocJson): EditorUpdateResult {
    if (!activeEditor.isEditable) {
      return {
        ok: false,
        error: new Error("RichTextEditor is in readOnly mode."),
        preservedTiptapJson: session.getLastValidTiptapJson(),
        minimumSchemaVersion: session.getMinimumSchemaVersion(),
        locale: session.getLocale(),
      };
    }

    const candidateEditor = new Editor({
      extensions,
      content: candidateDocJson,
      editable: !options.readOnly,
      editorProps: {
        attributes: {
          dir: session.getLocale().dir,
          lang: session.getLocale().lang,
        },
      },
      onUpdate: ({ editor }) => {
        session.handleEditorUpdate(editor.getJSON() as TiptapDocJson);
      },
    });

    const parsedJson = candidateEditor.getJSON() as TiptapDocJson;
    const result = session.handleEditorUpdate(parsedJson);

    if (result.ok) {
      activeEditor.destroy();
      activeEditor = candidateEditor;
    } else {
      candidateEditor.destroy();
    }

    return result;
  }

  function updateImageAttributesAt(
    imageOccurrenceIndex: number,
    attrsPatch: Record<string, unknown>
  ): EditorUpdateResult {
    const currentDoc = JSON.parse(
      JSON.stringify(activeEditor.getJSON())
    ) as TiptapDocJson;
    const content = Array.isArray(currentDoc.content) ? currentDoc.content : [];
    const blockIdx = findEditorialImageBlockIndex(content, imageOccurrenceIndex);
    if (blockIdx === -1) {
      throw new Error(
        `No editorialImage node found at occurrence index ${imageOccurrenceIndex}.`
      );
    }

    const currentNode = content[blockIdx];
    const nextAttrs: Record<string, unknown> = {
      ...currentNode.attrs,
      ...attrsPatch,
    };

    content[blockIdx] = {
      ...currentNode,
      attrs: nextAttrs,
    };

    return applyCandidateDocJson({
      type: "doc",
      content,
    });
  }

  function deleteImageNodeAt(imageOccurrenceIndex = 0): EditorUpdateResult {
    const currentDoc = JSON.parse(
      JSON.stringify(activeEditor.getJSON())
    ) as TiptapDocJson;
    const content = Array.isArray(currentDoc.content) ? currentDoc.content : [];
    const blockIdx = findEditorialImageBlockIndex(content, imageOccurrenceIndex);
    if (blockIdx === -1) {
      throw new Error(
        `No editorialImage node found at occurrence index ${imageOccurrenceIndex}.`
      );
    }

    const remainingContent = content.filter((_, idx) => idx !== blockIdx);
    const safeContent =
      remainingContent.length > 0
        ? remainingContent
        : [
            {
              type: "paragraph",
              attrs: {
                dir: session.getLocale().dir,
                textAlign: session.getLocale().dir === "rtl" ? "right" : "left",
              },
            },
          ];

    return applyCandidateDocJson({
      type: "doc",
      content: safeContent,
    });
  }

  return {
    getEditor() {
      return activeEditor;
    },
    session,
    getDocumentWrapper() {
      return tiptapJsonToRichDocumentByVersion(
        normalizeTiptapDocDefaultNullAttrs(
          activeEditor.getJSON() as TiptapDocJson
        ),
        session.getMinimumSchemaVersion()
      );
    },
    requestInsertInlineImage(explicitSelectionRange) {
      const req = createEditorialImageInsertionRequest({
        editor: activeEditor,
        session,
        isReadOnly: () => Boolean(options.readOnly) || !activeEditor.isEditable,
        isInstanceDestroyed: () => isHarnessDestroyed,
        getCurrentEditor: () => activeEditor,
        explicitSelectionRange,
      });
      options.onRequestInsertInlineImage?.(req);
      return req;
    },
    createImageNodeActions(imageOccurrenceIndex = 0): EditorialImageNodeActions {
      const currentDoc = activeEditor.getJSON() as TiptapDocJson;
      const content = Array.isArray(currentDoc.content) ? currentDoc.content : [];
      const blockIdx = findEditorialImageBlockIndex(content, imageOccurrenceIndex);
      if (blockIdx === -1) {
        throw new Error(
          `No editorialImage node found at occurrence index ${imageOccurrenceIndex}.`
        );
      }

      const rawAttrs = content[blockIdx]?.attrs || {};
      const effectiveWidth: EditorialImageWidthV2 =
        rawAttrs.width &&
        ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(
          rawAttrs.width as EditorialImageWidthV2
        )
          ? (rawAttrs.width as EditorialImageWidthV2)
          : "50%";
      const effectiveLayout: EditorialImageLayoutV2 =
        rawAttrs.layout &&
        ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(
          rawAttrs.layout as EditorialImageLayoutV2
        )
          ? (rawAttrs.layout as EditorialImageLayoutV2)
          : "float-start";

      const isAr = session.getLocale().lang === "ar";

      return createEditorialImageNodeActions({
        effectiveWidth,
        effectiveLayout,
        isAr,
        updateAttributes: (patch) => {
          updateImageAttributesAt(imageOccurrenceIndex, patch);
        },
        deleteNode: () => {
          deleteImageNodeAt(imageOccurrenceIndex);
        },
      });
    },
    updateImageAttributesAt,
    deleteImageNodeAt,
    destroy() {
      isHarnessDestroyed = true;
      activeEditor.destroy();
    },
  };
}

export interface RichTextEditorNodeViewScopeProps {
  locale: EditorialImageLocaleContextValue;
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  children: ReactNode;
}

/**
 * Provides instance-scoped locale (Arabic RTL vs English LTR) and runtime assetId preview lookup
 * context to EditorialImageNodeView instances inside RichTextEditor.
 */
export function RichTextEditorNodeViewScope({
  locale,
  previewUrlsByAssetId,
  children,
}: RichTextEditorNodeViewScopeProps) {
  return (
    <EditorialImageLocaleContext.Provider value={locale}>
      <EditorialImagePreviewContext.Provider
        value={{ previewUrlsByAssetId: previewUrlsByAssetId ?? {} }}
      >
        <div
          data-testid="rich-text-editor-content"
          dir={locale.dir}
          lang={locale.lang}
          className="p-4 flex-1 prose max-w-none"
        >
          {children}
        </div>
      </EditorialImagePreviewContext.Provider>
    </EditorialImageLocaleContext.Provider>
  );
}

export function RichTextEditor({
  value,
  onChange,
  readOnly = false,
  lang,
  dir,
  previewUrlsByAssetId,
  getPreviewUrl,
  onRequestInsertInlineImage,
}: RichTextEditorProps) {
  const sessionRef = useRef<RichTextEditorDocumentSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createRichTextEditorDocumentSession({
      initialValue: value,
      onChange,
      lang,
      dir,
      readOnly,
      previewUrlsByAssetId,
      getPreviewUrl,
      onRequestInsertInlineImage,
    });
  }
  sessionRef.current.setOnChange(onChange);
  sessionRef.current.setExplicitLocale({ lang, dir });

  const instanceLocale = resolveEditorInstanceLocale(
    value,
    { lang, dir },
    sessionRef.current.getLocale()
  );

  const extensions = getE1CTiptapExtensions({
    previewUrlsByAssetId,
    getPreviewUrl,
  });

  const tiptapEditor = useEditor({
    extensions,
    content: sessionRef.current.getInitialTiptapJson(),
    editable: !readOnly,
    editorProps: {
      attributes: {
        dir: instanceLocale.dir,
        lang: instanceLocale.lang,
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      sessionRef.current?.handleEditorUpdate(
        activeEditor.getJSON() as TiptapDocJson
      );
    },
  });

  const ssrEditorRef = useRef<Editor | null>(null);
  if (!tiptapEditor && typeof window === "undefined") {
    if (!ssrEditorRef.current || isEditorInstanceDestroyed(ssrEditorRef.current)) {
      ssrEditorRef.current = new Editor({
        extensions,
        content: sessionRef.current.getInitialTiptapJson(),
        editable: !readOnly,
        editorProps: {
          attributes: {
            dir: instanceLocale.dir,
            lang: instanceLocale.lang,
          },
        },
      });
    } else if (ssrEditorRef.current.isEditable !== !readOnly) {
      ssrEditorRef.current.setEditable(!readOnly, false);
    }
  }

  const editor = tiptapEditor ?? ssrEditorRef.current;

  useEffect(() => {
    if (!editor || isEditorInstanceDestroyed(editor) || !sessionRef.current) return;
    sessionRef.current.syncExternalValue(value, editor);
  }, [value, editor]);

  if (!editor) return null;

  const canInsertInlineImage =
    typeof onRequestInsertInlineImage === "function" &&
    !readOnly &&
    editor.isEditable;

  const handleTriggerInsertInlineImage = () => {
    if (
      !canInsertInlineImage ||
      !onRequestInsertInlineImage ||
      !sessionRef.current ||
      isEditorInstanceDestroyed(editor)
    ) {
      return;
    }

    const request = createEditorialImageInsertionRequest({
      editor,
      session: sessionRef.current,
      isReadOnly: () => Boolean(readOnly) || !editor.isEditable,
      isInstanceDestroyed: () => isEditorInstanceDestroyed(editor),
      getCurrentEditor: () => editor,
    });

    onRequestInsertInlineImage(request);
  };

  const ToolbarButton = ({
    onClick,
    icon: Icon,
    isActive,
    title,
    testId,
  }: any) => (
    <button
      type="button"
      data-testid={testId}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-1.5 rounded-md transition-colors ${
        isActive
          ? "bg-emerald-100 text-emerald-700"
          : "text-gray-600 hover:bg-gray-100"
      }`}
      title={title}
      disabled={readOnly}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col min-h-[300px]">
      {!readOnly && (
        <div className="border-b border-gray-200 p-2 flex flex-wrap gap-1 bg-gray-50">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            icon={Bold}
            isActive={editor.isActive("bold")}
            title="Bold"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            icon={Italic}
            isActive={editor.isActive("italic")}
            title="Italic"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            icon={UnderlineIcon}
            isActive={editor.isActive("underline")}
            title="Underline"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            icon={Strikethrough}
            isActive={editor.isActive("strike")}
            title="Strike"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleLink({ href: "" }).run()}
            icon={Link}
            isActive={editor.isActive("link")}
            title="Link"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            icon={List}
            isActive={editor.isActive("bulletList")}
            title="Bullet List"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            icon={ListOrdered}
            isActive={editor.isActive("orderedList")}
            title="Numbered List"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            icon={Quote}
            isActive={editor.isActive("blockquote")}
            title="Blockquote"
          />
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            icon={Heading2}
            isActive={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          />
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            icon={Heading3}
            isActive={editor.isActive("heading", { level: 3 })}
            title="Heading 3"
          />
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 4 }).run()
            }
            icon={Heading4}
            isActive={editor.isActive("heading", { level: 4 })}
            title="Heading 4"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            icon={AlignLeft}
            isActive={editor.isActive({ textAlign: "left" })}
            title="Align Left"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            icon={AlignCenter}
            isActive={editor.isActive({ textAlign: "center" })}
            title="Align Center"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            icon={AlignRight}
            isActive={editor.isActive({ textAlign: "right" })}
            title="Align Right"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            icon={AlignJustify}
            isActive={editor.isActive({ textAlign: "justify" })}
            title="Align Justify"
          />
          {canInsertInlineImage && (
            <ToolbarButton
              testId="rte-insert-inline-image-btn"
              onClick={handleTriggerInsertInlineImage}
              icon={ImageIcon}
              isActive={false}
              title={
                instanceLocale.lang === "ar"
                  ? "إدراج صورة مضمنة"
                  : "Insert Inline Image"
              }
            />
          )}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            icon={Undo}
            title="Undo"
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            icon={Redo}
            title="Redo"
          />
        </div>
      )}
      <RichTextEditorNodeViewScope
        locale={instanceLocale}
        previewUrlsByAssetId={previewUrlsByAssetId}
      >
        <EditorContent editor={editor} />
      </RichTextEditorNodeViewScope>
    </div>
  );
}


