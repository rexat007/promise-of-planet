import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { getE1CTiptapExtensions } from "./tiptapExtensions";
import {
  EditorialImageExtension,
  EditorialImageNodeView,
  EditorialImageLocaleContext,
  EditorialImagePreviewContext,
  ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS,
  ALLOWED_EDITORIAL_IMAGE_LAYOUTS,
  ALLOWED_EDITORIAL_IMAGE_WIDTHS,
  EDITORIAL_IMAGE_LAYOUT_CSS,
  validateCanonicalEditorialImageAttrs,
  computeEditorialImageFloatStyle,
  computeToolbarClampedPosition,
  createEditorialImageNodeActions,
  createOwnedPreviewUrlRegistry,
  isSafeRuntimePreviewUrl,
  insertCanonicalEditorialImageNode,
} from "./editorialImageExtension";
import {
  tiptapJsonToRichDocument,
  tiptapJsonToRichDocumentV2,
  richDocumentV2ToTiptapJson,
  tiptapJsonToRichDocumentByVersion,
  richDocumentToTiptapJsonByVersion,
  type TiptapDocJson,
} from "../../../services/richNewsTiptapAdapter";
import {
  validateRichNewsDocument,
  validateRichNewsDocumentV2,
  validateRichNewsDocumentByVersion,
  extractPlainTextFromRichDocument,
} from "../../../services/richNewsDocumentContract";
import type {
  EditorialImageNodeAttrsV2,
  EditorialImageNodeV2,
  RichNewsDocumentWrapperV2,
} from "../../../types/richNewsDocument";

function getExtensionsWithEditorialImage() {
  return [...getE1CTiptapExtensions(), EditorialImageExtension];
}

function createMockNodeViewProps(
  overrides: {
    attrs?: Record<string, unknown>;
    selected?: boolean;
    dir?: "rtl" | "ltr";
    updateAttributes?: (attrs: Record<string, unknown>) => void;
    deleteNode?: () => void;
    extensionOptions?: Record<string, unknown>;
  } = {}
): any {
  const dir = overrides.dir ?? "rtl";
  return {
    node: {
      type: { name: "editorialImage" },
      attrs: {
        assetId: "asset_2026_oases_001",
        altAr: "صورة توثيقية لواحة الأمل",
        altEn: "Documentary photo of Hope Oasis",
        captionAr: "شتلات السدر في المحمية الطبيعية",
        captionEn: "Sidr saplings in the nature reserve",
        width: "50%",
        layout: "float-start",
        ...overrides.attrs,
      },
    },
    updateAttributes: overrides.updateAttributes ?? vi.fn(),
    deleteNode: overrides.deleteNode ?? vi.fn(),
    selected: overrides.selected ?? false,
    extension: {
      name: "editorialImage",
      options: overrides.extensionOptions ?? {},
    },
    editor: {
      view: {
        dom: {
          getAttribute: (name: string) => (name === "dir" ? dir : null),
          getBoundingClientRect: () => ({
            top: 100,
            bottom: 700,
            left: 100,
            right: 900,
            width: 800,
            height: 600,
          }),
        },
      },
    },
    decorations: [],
    innerDecorations: [],
    view: {},
    getPos: () => 1,
    HTMLAttributes: {},
  };
}

describe("IMG-F3-09/D2-A — Canonical Inline Image NodeView & Extension", () => {
  // 1. Canonical V2 serialization via editor.getJSON()
  it("1. serializes canonical V2 editorialImage node via editor.getJSON() without extra HTML img attributes", () => {
    const v2Wrapper: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة افتتاحية قبل الصورة" }],
          },
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_canonical_001",
              altAr: "صورة ميدانية",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };

    const editor = new Editor({
      extensions: getExtensionsWithEditorialImage(),
      content: richDocumentV2ToTiptapJson(v2Wrapper),
    });

    const rawJson = editor.getJSON() as TiptapDocJson;
    const imageNode = rawJson.content?.[1];
    expect(imageNode?.type).toBe("editorialImage");

    // Verify no inherited Image attributes (src, alt, title, credit, alignment) exist
    expect(Object.keys(imageNode?.attrs || {}).sort()).toEqual(
      [
        "assetId",
        "altAr",
        "altEn",
        "captionAr",
        "captionEn",
        "width",
        "layout",
      ].sort()
    );
    expect(imageNode?.attrs).not.toHaveProperty("src");
    expect(imageNode?.attrs).not.toHaveProperty("alt");
    expect(imageNode?.attrs).not.toHaveProperty("title");
    expect(imageNode?.attrs).not.toHaveProperty("credit");
    expect(imageNode?.attrs).not.toHaveProperty("alignment");

    // Round-trips cleanly through V2 adapter and passes strict V2 validator
    const roundTripped = tiptapJsonToRichDocumentV2(rawJson);
    expect(roundTripped).toEqual(v2Wrapper);
    const roundTrippedImageNode = roundTripped.doc
      .content[1] as EditorialImageNodeV2;
    expect(Object.keys(roundTrippedImageNode.attrs).sort()).toEqual(
      ["assetId", "altAr", "width", "layout"].sort()
    );

    const validationResult = validateRichNewsDocumentV2(roundTripped);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toEqual([]);

    editor.destroy();
  });

  // 2. All seven allowed image attributes
  it("2. preserves all seven canonical V2 attributes (assetId, altAr, altEn, captionAr, captionEn, width, layout)", () => {
    const fullAttrs: EditorialImageNodeAttrsV2 = {
      assetId: "asset_full_7_attrs_2026",
      altAr: "النص البديل بالعربية",
      altEn: "Alternative text in English",
      captionAr: "التعليق التوضيحي بالعربية أسفل الصورة",
      captionEn: "Caption text in English below image",
      width: "75%",
      layout: "block-center",
    };

    const validation = validateCanonicalEditorialImageAttrs(fullAttrs);
    expect(validation.valid).toBe(true);
    expect(validation.attrs).toEqual(fullAttrs);

    const v2Wrapper: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [{ type: "editorialImage", attrs: fullAttrs }],
      },
    };

    const editor = new Editor({
      extensions: getExtensionsWithEditorialImage(),
      content: richDocumentV2ToTiptapJson(v2Wrapper),
    });

    const json = editor.getJSON() as TiptapDocJson;
    const converted = tiptapJsonToRichDocumentV2(json);
    expect(converted.doc.content[0]).toEqual({
      type: "editorialImage",
      attrs: fullAttrs,
    });

    expect(Array.from(ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS).sort()).toEqual(
      [
        "assetId",
        "altAr",
        "altEn",
        "captionAr",
        "captionEn",
        "width",
        "layout",
      ].sort()
    );

    editor.destroy();
  });

  // 3. Rejection of forbidden attributes
  it("3. fails closed and rejects forbidden attributes (src, publicUrl, storagePath, blob:, data:, credit, title, alt, alignment, GCS paths)", () => {
    const baseValid: EditorialImageNodeAttrsV2 = {
      assetId: "asset_safe_100",
      altAr: "وصف عربي آمن",
      width: "50%",
      layout: "float-start",
    };

    const forbiddenAttrCases: Array<Record<string, unknown>> = [
      { ...baseValid, src: "https://example.com/photo.jpg" },
      { ...baseValid, publicUrl: "https://cdn.example.com/photo.jpg" },
      { ...baseValid, storagePath: "news_assets/photo.jpg" },
      { ...baseValid, credit: "Photo Agency" },
      { ...baseValid, title: "Image Title" },
      { ...baseValid, alt: "Legacy Alt" },
      { ...baseValid, alignment: "float-start" },
      { ...baseValid, unknownField: "unexpected" },
      { ...baseValid, assetId: "blob:http://localhost:3000/abc-123" },
      { ...baseValid, assetId: "data:image/png;base64,AAAA" },
      { ...baseValid, assetId: "gs://promise-of-planet.appspot.com/img.jpg" },
      {
        ...baseValid,
        altAr: "https://firebasestorage.googleapis.com/v0/b/bucket/o/img.jpg",
      },
      {
        ...baseValid,
        captionAr: "blob:https://example.com/temp-id",
      },
      {
        ...baseValid,
        captionEn: "data:image/jpeg;base64,BBBB",
      },
      {
        ...baseValid,
        altEn: "https://storage.googleapis.com/private-bucket/file.webp",
      },
    ];

    for (const candidate of forbiddenAttrCases) {
      const res = validateCanonicalEditorialImageAttrs(candidate);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);

      const mockEditor = {
        chain: () => ({
          focus: () => ({
            insertContent: () => ({ run: vi.fn() }),
          }),
        }),
      };
      expect(() =>
        insertCanonicalEditorialImageNode(mockEditor, candidate)
      ).toThrow(/INVALID_EDITORIAL_IMAGE_ATTRS/);
    }
  });

  // 4. Width presets
  it("4. supports all four canonical width presets (25%, 50%, 75%, 100%) and updates only canonical attributes", () => {
    expect(ALLOWED_EDITORIAL_IMAGE_WIDTHS).toEqual(["25%", "50%", "75%", "100%"]);

    const html = renderToStaticMarkup(
      <EditorialImageNodeView
        {...createMockNodeViewProps({
          attrs: { width: "50%", layout: "float-start" },
          selected: true,
        })}
      />
    );

    for (const preset of ALLOWED_EDITORIAL_IMAGE_WIDTHS) {
      expect(html).toContain(`data-testid="editorial-image-width-${preset}"`);

      const updateAttributes = vi.fn();
      const actions = createEditorialImageNodeActions({
        effectiveWidth: "50%",
        effectiveLayout: "float-start",
        isAr: true,
        updateAttributes,
        deleteNode: vi.fn(),
      });

      actions.handleSetWidth(preset);
      expect(updateAttributes).toHaveBeenCalledTimes(1);

      const updatedPayload = updateAttributes.mock.calls[0][0];
      if (preset === "100%") {
        expect(updatedPayload).toEqual({ width: "100%", layout: "block-full" });
      } else {
        expect(updatedPayload).toEqual({ width: preset });
      }
      expect(updatedPayload).not.toHaveProperty("alignment");
      expect(updatedPayload).not.toHaveProperty("src");
    }
  });

  // 5. Logical RTL/LTR floats
  it("5. computes logical RTL and LTR float styles for float-start, float-end, block-center, and block-full", () => {
    expect(ALLOWED_EDITORIAL_IMAGE_LAYOUTS).toEqual([
      "float-start",
      "float-end",
      "block-center",
      "block-full",
    ]);

    // RTL (Arabic): float-start -> right, float-end -> left
    const rtlStart = computeEditorialImageFloatStyle("float-start", "50%", true);
    expect(rtlStart.float).toBe("right");
    expect(rtlStart.marginLeft).toBe("1.25rem");
    expect(rtlStart.marginRight).toBe("0");
    expect(rtlStart.width).toBe("50%");

    const rtlEnd = computeEditorialImageFloatStyle("float-end", "25%", true);
    expect(rtlEnd.float).toBe("left");
    expect(rtlEnd.marginRight).toBe("1.25rem");
    expect(rtlEnd.marginLeft).toBe("0");
    expect(rtlEnd.width).toBe("25%");

    // LTR (English): float-start -> left, float-end -> right
    const ltrStart = computeEditorialImageFloatStyle("float-start", "50%", false);
    expect(ltrStart.float).toBe("left");
    expect(ltrStart.marginRight).toBe("1.25rem");
    expect(ltrStart.marginLeft).toBe("0");
    expect(ltrStart.width).toBe("50%");

    const ltrEnd = computeEditorialImageFloatStyle("float-end", "75%", false);
    expect(ltrEnd.float).toBe("right");
    expect(ltrEnd.marginLeft).toBe("1.25rem");
    expect(ltrEnd.marginRight).toBe("0");
    expect(ltrEnd.width).toBe("75%");

    // 100% width with float-start/float-end collapses float cleanly
    const fullFloat = computeEditorialImageFloatStyle("float-start", "100%", true);
    expect(fullFloat.float).toBe("none");
    expect(fullFloat.clear).toBe("both");
    expect(fullFloat.width).toBe("100%");

    // block-center & block-full
    const blockCenter = computeEditorialImageFloatStyle("block-center", "50%", true);
    expect(blockCenter.float).toBe("none");
    expect(blockCenter.marginLeft).toBe("auto");
    expect(blockCenter.marginRight).toBe("auto");
    expect(blockCenter.width).toBe("50%");

    const blockFull = computeEditorialImageFloatStyle("block-full", "100%", false);
    expect(blockFull.float).toBe("none");
    expect(blockFull.width).toBe("100%");

    // Verify rendered buttons and canonical updateAttributes without `alignment`
    const html = renderToStaticMarkup(
      <EditorialImageNodeView {...createMockNodeViewProps({ selected: true })} />
    );

    for (const layout of ALLOWED_EDITORIAL_IMAGE_LAYOUTS) {
      expect(html).toContain(`data-testid="editorial-image-layout-${layout}"`);

      const updateAttributes = vi.fn();
      const actions = createEditorialImageNodeActions({
        effectiveWidth: "50%",
        effectiveLayout: "float-start",
        isAr: true,
        updateAttributes,
        deleteNode: vi.fn(),
      });

      actions.handleSetLayout(layout);
      expect(updateAttributes).toHaveBeenCalledTimes(1);
      const arg = updateAttributes.mock.calls[0][0];
      expect(arg.layout).toBe(layout);
      expect(arg).not.toHaveProperty("alignment");
    }
  });

  // 6. Text wrapping and mobile layout rules
  it("6. includes responsive text wrapping and mobile collapse (<640px) CSS rules and figure layout classes", () => {
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="rtl"] .pop-layout-float-start');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="rtl"] .pop-layout-float-end');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="ltr"] .pop-layout-float-start');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="ltr"] .pop-layout-float-end');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("@media (max-width: 640px)");
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("float: none !important;");
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("width: 100% !important;");

    const html = renderToStaticMarkup(
      <EditorialImageLocaleContext.Provider value={{ lang: "ar", dir: "rtl" }}>
        <EditorialImageNodeView
          {...createMockNodeViewProps({
            attrs: { layout: "float-end", width: "50%" },
          })}
        />
      </EditorialImageLocaleContext.Provider>
    );

    expect(html).toContain("pop-editorial-figure");
    expect(html).toContain("pop-layout-float-end");
    expect(html).toContain('data-layout="float-end"');
    expect(html).toContain('data-width="50%"');
  });

  // 7. Toolbar bounds and selected-state behavior
  it("7. clamps contextual toolbar horizontally within editor bounds and switches between above/below placement", () => {
    const editorRect = {
      top: 100,
      bottom: 700,
      left: 100,
      right: 500,
      width: 400,
    };

    // Centered figure with plenty of top space -> shiftX = 0, placement = "above"
    const centered = computeToolbarClampedPosition({
      figureRect: { top: 250, bottom: 450, left: 200, right: 400, width: 200 },
      editorRect,
      toolbarWidth: 240,
      toolbarHeight: 40,
    });
    expect(centered.shiftX).toBe(0);
    expect(centered.placement).toBe("above");

    // Near left boundary -> positive shiftX to prevent left overflow
    const nearLeft = computeToolbarClampedPosition({
      figureRect: { top: 250, bottom: 450, left: 100, right: 180, width: 80 },
      editorRect,
      toolbarWidth: 260,
      toolbarHeight: 40,
    });
    expect(nearLeft.shiftX).toBeGreaterThan(0);
    expect(nearLeft.placement).toBe("above");

    // Near right boundary -> negative shiftX to prevent right overflow
    const nearRight = computeToolbarClampedPosition({
      figureRect: { top: 250, bottom: 450, left: 420, right: 500, width: 80 },
      editorRect,
      toolbarWidth: 260,
      toolbarHeight: 40,
    });
    expect(nearRight.shiftX).toBeLessThan(0);
    expect(nearRight.placement).toBe("above");

    // Near top of editor -> flips placement to "below"
    const nearTop = computeToolbarClampedPosition({
      figureRect: { top: 110, bottom: 310, left: 200, right: 400, width: 200 },
      editorRect,
      toolbarWidth: 240,
      toolbarHeight: 40,
    });
    expect(nearTop.placement).toBe("below");

    // Selected vs unselected toolbar visibility in rendered markup
    const unselectedHtml = renderToStaticMarkup(
      <EditorialImageNodeView {...createMockNodeViewProps({ selected: false })} />
    );
    expect(unselectedHtml).toContain('data-toolbar-visible="false"');
    expect(unselectedHtml).toContain("opacity-0 pointer-events-none");

    const selectedHtml = renderToStaticMarkup(
      <EditorialImageNodeView {...createMockNodeViewProps({ selected: true })} />
    );
    expect(selectedHtml).toContain('data-toolbar-visible="true"');
    expect(selectedHtml).toContain("border-emerald-600");
    expect(selectedHtml).toContain('data-testid="editorial-image-caption-input"');
  });

  // 8. Node deletion
  it("8. invokes deleteNode() when the delete toolbar action is triggered", () => {
    const deleteNode = vi.fn();
    const html = renderToStaticMarkup(
      <EditorialImageNodeView
        {...createMockNodeViewProps({
          selected: true,
          deleteNode,
        })}
      />
    );
    expect(html).toContain('data-testid="editorial-image-delete"');

    const actions = createEditorialImageNodeActions({
      effectiveWidth: "50%",
      effectiveLayout: "float-start",
      isAr: true,
      updateAttributes: vi.fn(),
      deleteNode,
    });

    actions.handleDeleteNode();
    expect(deleteNode).toHaveBeenCalledTimes(1);
  });

  // 9. Drag capability
  it("9. configures extension with draggable: true and renders data-drag-handle on figure and grip control", () => {
    expect(EditorialImageExtension.config.draggable).toBe(true);
    expect(EditorialImageExtension.config.selectable).toBe(true);
    expect(EditorialImageExtension.config.atom).toBe(true);

    const html = renderToStaticMarkup(
      <EditorialImageNodeView {...createMockNodeViewProps({ selected: true })} />
    );
    expect(html).toContain('data-testid="editorial-image-drag-handle"');
    expect(html).toContain('data-drag-handle=""');
  });

  // 10. Private-asset placeholder when assetId has no runtime preview entry
  it("10. renders a private-asset placeholder (and never a broken <img> or inferred URL) when assetId has no runtime preview entry", () => {
    const html = renderToStaticMarkup(
      <EditorialImagePreviewContext.Provider value={{ previewUrlsByAssetId: {} }}>
        <EditorialImageNodeView
          {...createMockNodeViewProps({
            attrs: {
              assetId: "asset_unmapped_private_77",
              altAr: "صورة أرشيفية خاصة",
              width: "50%",
              layout: "float-start",
            },
          })}
        />
      </EditorialImagePreviewContext.Provider>
    );

    expect(html).toContain('data-testid="editorial-image-private-placeholder"');
    expect(html).toContain("asset_unmapped_private_77");
    expect(html).toContain("صورة أرشيفية خاصة");
    expect(html).not.toContain('data-testid="editorial-image-preview-img"');
    expect(html).not.toContain("<img");
  });

  // 11. No temporary URL persistence & ownership-safe URL cleanup
  it("11. renders runtime preview URL from context without persisting blob:/data: into editor.getJSON(), and revokes only owned URLs", () => {
    const revokeSpy = vi.fn();
    const registry = createOwnedPreviewUrlRegistry(revokeSpy);

    const ownedBlobUrl = "blob:https://promise-of-planet.local/owned-uuid-111";
    const externalBlobUrl = "blob:https://promise-of-planet.local/external-uuid-222";

    registry.registerOwnedPreviewUrl("asset_owned_1", ownedBlobUrl);
    registry.registerExternalPreviewUrl("asset_external_2", externalBlobUrl);

    expect(registry.isUrlOwned("asset_owned_1")).toBe(true);
    expect(registry.isUrlOwned("asset_external_2")).toBe(false);

    const previewMap = registry.getPreviewMap();
    expect(previewMap["asset_owned_1"]).toBe(ownedBlobUrl);
    expect(previewMap["asset_external_2"]).toBe(externalBlobUrl);

    // Render NodeView with runtime preview context
    const htmlWithPreview = renderToStaticMarkup(
      <EditorialImagePreviewContext.Provider
        value={{ previewUrlsByAssetId: previewMap }}
      >
        <EditorialImageNodeView
          {...createMockNodeViewProps({
            attrs: {
              assetId: "asset_owned_1",
              altAr: "صورة مع معاينة مؤقتة",
              width: "50%",
              layout: "float-start",
            },
          })}
        />
      </EditorialImagePreviewContext.Provider>
    );

    expect(htmlWithPreview).toContain('data-testid="editorial-image-preview-img"');
    expect(htmlWithPreview).toContain(`src="${ownedBlobUrl}"`);

    // Verify Tiptap Editor JSON NEVER contains the temporary blob URL
    const editor = new Editor({
      extensions: [
        ...getE1CTiptapExtensions(),
        EditorialImageExtension.configure({
          previewUrlsByAssetId: previewMap,
        }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_owned_1",
              altAr: "صورة مع معاينة مؤقتة",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    });

    const serializedJsonString = JSON.stringify(editor.getJSON());
    expect(serializedJsonString).not.toContain("blob:");
    expect(serializedJsonString).not.toContain("owned-uuid-111");
    expect(serializedJsonString).toContain("asset_owned_1");
    editor.destroy();

    // Verify releasing external asset does NOT revoke external caller's URL
    registry.releaseAssetPreviewUrl("asset_external_2");
    expect(revokeSpy).not.toHaveBeenCalled();

    // Verify revoking all owned URLs revokes ONLY ownedBlobUrl
    registry.revokeAllOwnedPreviewUrls();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(ownedBlobUrl);

    // Unsafe runtime URLs are rejected
    expect(isSafeRuntimePreviewUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeRuntimePreviewUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeRuntimePreviewUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });

  // 12. No mutation of Sandbox files
  it("12. leaves Sandbox source files completely untouched with their exact baseline Git blob SHA-1", () => {
    const computeBlobSha1 = (relPath: string) => {
      const fullPath = path.resolve(process.cwd(), relPath);
      const buf = fs.readFileSync(fullPath);
      return crypto
        .createHash("sha1")
        .update(`blob ${buf.length}\0`)
        .update(buf)
        .digest("hex");
    };

    expect(
      computeBlobSha1(
        "src/components/news/editor/sandbox/imageEditorSandboxExtensions.ts"
      )
    ).toBe("cbd2d0a1eae2a5cdf538d7d804b41f3b20a87bf6");

    expect(
      computeBlobSha1("src/components/news/editor/RichTextEditor.tsx")
    ).toBe("2bd669f5744101b33cfc3330fa98eb0c0fa33546");

    expect(
      computeBlobSha1("src/components/news/editor/tiptapExtensions.ts")
    ).toBe("81be9540e527d2e1ba3a397d3590414f5bbac8f1");
  });

  // 13. Existing rich news adapter compatibility
  it("13. round-trips seamlessly through version-dispatched richNewsTiptapAdapter and richNewsDocumentContract", () => {
    const v2Doc: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, dir: "rtl" },
            content: [{ type: "text", text: "عنوان فرعي للتقرير" }],
          },
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_roundtrip_2026",
              altAr: "صورة الغطاء النباتي",
              altEn: "Vegetation cover image",
              captionAr: "مشهد من منطقة الدراسة",
              captionEn: "View from the study area",
              width: "75%",
              layout: "float-end",
            },
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة ختامية بعد الصورة." }],
          },
        ],
      },
    };

    const tiptapInput = richDocumentToTiptapJsonByVersion(v2Doc);
    const editor = new Editor({
      extensions: getExtensionsWithEditorialImage(),
      content: tiptapInput,
    });

    const editorJson = editor.getJSON() as TiptapDocJson;
    const roundTripped = tiptapJsonToRichDocumentByVersion(editorJson, 2);

    expect(roundTripped).toEqual(v2Doc);
    expect(validateRichNewsDocumentByVersion(roundTripped)).toEqual({
      valid: true,
      errors: [],
    });

    // V1 validator still rejects V2 documents containing editorialImage
    expect(validateRichNewsDocument(roundTripped).valid).toBe(false);
    expect(() => tiptapJsonToRichDocument(editorJson)).toThrow(
      /Disallowed or unknown node type: "editorialImage"/
    );

    // Plain-text extraction preserves paragraph/heading text and ignores editorialImage
    const plainText = extractPlainTextFromRichDocument(roundTripped);
    expect(plainText).toBe("عنوان فرعي للتقرير\n\nفقرة ختامية بعد الصورة.");

    editor.destroy();
  });
});
