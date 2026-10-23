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
  Undo,
  Redo,
} from "lucide-react";

export type RichTextEditorDocumentValue =
  | RichNewsDocumentWrapper
  | RichNewsDocumentWrapperV2;

export interface RichTextEditorProps {
  value: RichTextEditorDocumentValue;
  onChange: (value: RichTextEditorDocumentValue) => void;
  readOnly?: boolean;
  lang?: "ar" | "en";
  dir?: "rtl" | "ltr";
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  getPreviewUrl?: (assetId: string) => string | undefined;
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
        const nextWrapper = tiptapJsonToRichDocumentByVersion(
          currentTiptapJson,
          minimumSchemaVersion
        );
        if (nextWrapper.schemaVersion === 2) {
          minimumSchemaVersion = 2;
        }
        locale = resolveEditorInstanceLocale(nextWrapper, explicitLocale, locale);
        lastValidTiptapJson = JSON.parse(JSON.stringify(currentTiptapJson));
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

        if (editorInstance && !editorInstance.isDestroyed) {
          const currentJson = editorInstance.getJSON();
          // Use stringification for deep content equality check to avoid infinite loops
          // or redundant setContent calls caused by reference inequality.
          if (JSON.stringify(currentJson) !== JSON.stringify(nextJson)) {
            editorInstance.commands?.setContent(nextJson, { emitUpdate: false });
          }
          if (editorInstance.view?.dom?.setAttribute) {
            editorInstance.view.dom.setAttribute("dir", locale.dir);
            editorInstance.view.dom.setAttribute("lang", locale.lang);
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

export interface ProductionRichTextEditorHarness {
  getEditor: () => Editor;
  session: RichTextEditorDocumentSession;
  getDocumentWrapper: () => RichTextEditorDocumentValue;
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
        activeEditor.getJSON() as TiptapDocJson,
        session.getMinimumSchemaVersion()
      );
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

  const editor = useEditor({
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

  useEffect(() => {
    if (!editor || editor.isDestroyed || !sessionRef.current) return;
    sessionRef.current.syncExternalValue(value, editor);
  }, [value, editor]);

  if (!editor) return null;

  const ToolbarButton = ({ onClick, icon: Icon, isActive, title }: any) => (
    <button
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

