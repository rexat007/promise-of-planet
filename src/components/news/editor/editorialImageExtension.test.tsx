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
  NARROW_EDITOR_CONTAINER_MAX_PX,
  WIDE_EDITOR_CONTAINER_MIN_PX,
  MIN_READABLE_PARAGRAPH_WIDTH_PX,
  COMPACT_TOOLBAR_MAX_CONTAINER_PX,
  validateCanonicalEditorialImageAttrs,
  resolveEditorialImageResponsivePresentation,
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
    editorWidth?: number;
    editorRect?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
      height: number;
    };
    updateAttributes?: (attrs: Record<string, unknown>) => void;
    deleteNode?: () => void;
    extensionOptions?: Record<string, unknown>;
  } = {}
): any {
  const dir = overrides.dir ?? "rtl";
  const width = overrides.editorWidth ?? 800;
  const rect = overrides.editorRect ?? {
    top: 100,
    bottom: 700,
    left: 100,
    right: 100 + width,
    width,
    height: 600,
  };

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
          getBoundingClientRect: () => rect,
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

describe("IMG-F3-09/D2-A & D2-C1 — Canonical Inline Image NodeView, Toolbar Containment & Container-Responsive Wrapping", () => {
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

  // 6. Text wrapping and container-collapse layout rules
  it("6. includes responsive text wrapping and container-collapse CSS rules and figure layout classes", () => {
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="rtl"] .pop-layout-float-start');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="rtl"] .pop-layout-float-end');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="ltr"] .pop-layout-float-start');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('[dir="ltr"] .pop-layout-float-end');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain('figure[data-float-collapsed="true"]');
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("@media (max-width: 640px)");
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("float: none !important;");
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("margin-left: auto !important;");
    expect(EDITORIAL_IMAGE_LAYOUT_CSS).toContain("margin-right: auto !important;");

    const html = renderToStaticMarkup(
      <EditorialImageLocaleContext.Provider value={{ lang: "ar", dir: "rtl" }}>
        <EditorialImageNodeView
          {...createMockNodeViewProps({
            attrs: { layout: "float-end", width: "50%" },
            editorWidth: 1024,
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
  it("7. clamps contextual toolbar horizontally within editor bounds and switches between above/below/inside-top placement", () => {
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
    expect(centered.clampedLeft).toBeGreaterThanOrEqual(editorRect.left + 8);
    expect(centered.clampedRight).toBeLessThanOrEqual(editorRect.right - 8);

    // Near left boundary -> positive shiftX to prevent left overflow
    const nearLeft = computeToolbarClampedPosition({
      figureRect: { top: 250, bottom: 450, left: 100, right: 180, width: 80 },
      editorRect,
      toolbarWidth: 260,
      toolbarHeight: 40,
    });
    expect(nearLeft.shiftX).toBeGreaterThan(0);
    expect(nearLeft.placement).toBe("above");
    expect(nearLeft.clampedLeft).toBe(editorRect.left + 8);
    expect(nearLeft.clampedRight).toBeLessThanOrEqual(editorRect.right - 8);

    // Near right boundary -> negative shiftX to prevent right overflow
    const nearRight = computeToolbarClampedPosition({
      figureRect: { top: 250, bottom: 450, left: 420, right: 500, width: 80 },
      editorRect,
      toolbarWidth: 260,
      toolbarHeight: 40,
    });
    expect(nearRight.shiftX).toBeLessThan(0);
    expect(nearRight.placement).toBe("above");
    expect(nearRight.clampedRight).toBe(editorRect.right - 8);
    expect(nearRight.clampedLeft).toBeGreaterThanOrEqual(editorRect.left + 8);

    // Near top of editor -> flips placement to "below"
    const nearTop = computeToolbarClampedPosition({
      figureRect: { top: 110, bottom: 310, left: 200, right: 400, width: 200 },
      editorRect,
      toolbarWidth: 240,
      toolbarHeight: 40,
    });
    expect(nearTop.placement).toBe("below");

    // Tall figure filling both top and bottom of editor -> falls back to "inside-top" to avoid overflow-hidden clipping
    const tallFigure = computeToolbarClampedPosition({
      figureRect: { top: 105, bottom: 695, left: 200, right: 400, width: 200 },
      editorRect,
      toolbarWidth: 240,
      toolbarHeight: 40,
    });
    expect(tallFigure.placement).toBe("inside-top");

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

  // 12. Preserves read-only Sandbox, D2-D2B1 RichTextEditor, and visual harness files with verified Git blob SHA-1
  it("12. verifies Git blob SHA-1 convergence for Sandbox, D2-D2B1 RichTextEditor, tiptapExtensions, App, and visual harness files", () => {
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
    ).toBe("d3e098e376e3e57ad71fddbc88d39d98463c1383");

    expect(
      computeBlobSha1("src/components/news/editor/tiptapExtensions.ts")
    ).toBe("e9a613019d6cf4862100257f02e894c5535971a4");

    expect(computeBlobSha1("src/App.tsx")).toBe(
      "ad709a1429da07ba23d09c2dc564d01903dd64d6"
    );

    expect(
      computeBlobSha1(
        "src/components/news/editor/dev/RichTextEditorV2VisualHarness.tsx"
      )
    ).toBe("a5737566bb1386681e3bce1633b6b083982d995b");
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

  // 14. D2-C1 Correction A — Toolbar containment across 320, 375, 390, 600, 640, 768, 1024 and 1440px in RTL and LTR
  it("14. [D2-C1 Correction A] keeps toolbar strictly inside visible editor content bounds across 320, 375, 390, 600, 640, 768, 1024, and 1440px widths in RTL and LTR, including when natural toolbar width exceeds container width", () => {
    const requiredEditorWidths = [320, 375, 390, 600, 640, 768, 1024, 1440];
    const naturalToolbarWidthsToTest = [260, 330, 420];

    for (const editorWidth of requiredEditorWidths) {
      const editorRect = {
        top: 100,
        bottom: 700,
        left: 50,
        right: 50 + editorWidth,
        width: editorWidth,
        height: 600,
      };
      const minAllowedLeft = editorRect.left + 8;
      const maxAllowedRight = editorRect.right - 8;
      const availableWidth = maxAllowedRight - minAllowedLeft;

      for (const toolbarWidth of naturalToolbarWidthsToTest) {
        // Test left-edge figure (LTR float-start / RTL float-end), right-edge figure (RTL float-start / LTR float-end), and centered figure
        const figureWidth = Math.min(editorWidth, Math.round(editorWidth * 0.5));
        const placements = [
          {
            label: "left-aligned edge",
            left: editorRect.left,
            right: editorRect.left + figureWidth,
          },
          {
            label: "right-aligned edge",
            left: editorRect.right - figureWidth,
            right: editorRect.right,
          },
          {
            label: "centered",
            left: editorRect.left + (editorWidth - figureWidth) / 2,
            right: editorRect.left + (editorWidth + figureWidth) / 2,
          },
        ];

        for (const pos of placements) {
          const computed = computeToolbarClampedPosition({
            figureRect: {
              top: 220,
              bottom: 420,
              left: pos.left,
              right: pos.right,
              width: figureWidth,
            },
            editorRect,
            toolbarWidth,
            toolbarHeight: 40,
          });

          expect(computed.maxWidthPx).toBe(availableWidth);
          expect(computed.effectiveToolbarWidth).toBeLessThanOrEqual(availableWidth);
          expect(computed.clampedLeft).toBeGreaterThanOrEqual(minAllowedLeft - 0.01);
          expect(computed.clampedRight).toBeLessThanOrEqual(maxAllowedRight + 0.01);

          if (
            availableWidth < COMPACT_TOOLBAR_MAX_CONTAINER_PX ||
            toolbarWidth > availableWidth
          ) {
            expect(computed.isCompact).toBe(true);
          } else {
            expect(computed.isCompact).toBe(false);
          }
        }
      }

      // Verify rendered NodeView markup at this editorWidth in both RTL and LTR preserves all controls and sets max-width
      for (const dir of ["rtl", "ltr"] as const) {
        const html = renderToStaticMarkup(
          <EditorialImageLocaleContext.Provider
            value={{ lang: dir === "rtl" ? "ar" : "en", dir }}
          >
            <EditorialImageNodeView
              {...createMockNodeViewProps({
                selected: true,
                dir,
                editorWidth,
                attrs: { width: "50%", layout: "float-start" },
              })}
            />
          </EditorialImageLocaleContext.Provider>
        );

        expect(html).toContain(`data-toolbar-max-width="${availableWidth}"`);
        expect(html).toContain(`max-width:${availableWidth}px`);
        expect(html).toContain(
          `data-toolbar-compact="${availableWidth < COMPACT_TOOLBAR_MAX_CONTAINER_PX ? "true" : "false"}"`
        );

        // Confirm zero controls were removed
        expect(html).toContain('data-testid="editorial-image-drag-handle"');
        for (const w of ALLOWED_EDITORIAL_IMAGE_WIDTHS) {
          expect(html).toContain(`data-testid="editorial-image-width-${w}"`);
        }
        for (const l of ALLOWED_EDITORIAL_IMAGE_LAYOUTS) {
          expect(html).toContain(`data-testid="editorial-image-layout-${l}"`);
        }
        expect(html).toContain('data-testid="editorial-image-delete"');
      }
    }
  });

  // 15. D2-C1 Correction B — Container-aware responsive float collapse across 320, 375, 390, 600, 640, 768, 1024 and 1440px
  it("15. [D2-C1 Correction B] enforces container-aware float policy across 320, 375, 390, 600, 640, 768, 1024, and 1440px without mutating canonical V2 attributes", () => {
    expect(NARROW_EDITOR_CONTAINER_MAX_PX).toBe(640);
    expect(WIDE_EDITOR_CONTAINER_MIN_PX).toBe(1024);
    expect(MIN_READABLE_PARAGRAPH_WIDTH_PX).toBe(320);

    // 15a. Narrow containers (< 640px): 320, 375, 390, 600 -> all floated images (25%, 50%, 75%) collapse to centered blocks
    for (const narrowWidth of [320, 375, 390, 600]) {
      for (const floatLayout of ["float-start", "float-end"] as const) {
        for (const widthPreset of ["25%", "50%", "75%"] as const) {
          for (const isRtl of [true, false]) {
            const pres = resolveEditorialImageResponsivePresentation(
              floatLayout,
              widthPreset,
              isRtl,
              narrowWidth
            );

            expect(pres.containerTier).toBe("narrow");
            expect(pres.isFloatCollapsed).toBe(true);
            expect(pres.effectiveRenderLayout).toBe("block-center");
            // Canonical V2 attributes are preserved unchanged
            expect(pres.canonicalLayout).toBe(floatLayout);
            expect(pres.canonicalWidth).toBe(widthPreset);
            // Style renders centered independent block with no float
            expect(pres.style.float).toBe("none");
            expect(pres.style.display).toBe("block");
            expect(pres.style.clear).toBe("both");
            expect(pres.style.marginLeft).toBe("auto");
            expect(pres.style.marginRight).toBe("auto");
            expect(pres.style.width).toBe(widthPreset);
          }
        }
      }

      // Verify rendered NodeView in narrow container preserves canonical data-layout & data-width while setting data-float-collapsed="true"
      const narrowHtml = renderToStaticMarkup(
        <EditorialImageNodeView
          {...createMockNodeViewProps({
            editorWidth: narrowWidth,
            attrs: { width: "50%", layout: "float-start" },
          })}
        />
      );
      expect(narrowHtml).toContain('data-layout="float-start"');
      expect(narrowHtml).toContain('data-width="50%"');
      expect(narrowHtml).toContain('data-container-tier="narrow"');
      expect(narrowHtml).toContain('data-float-collapsed="true"');
      expect(narrowHtml).toContain('data-presentation-layout="block-center"');
      expect(narrowHtml).toContain("float:none");
      expect(narrowHtml).toContain("margin-left:auto");
      expect(narrowHtml).toContain("margin-right:auto");
    }

    // 15b. Medium container at 640px:
    // - 25% leaves 640 * 0.75 - 20 = 460px (>= 320px) -> wraps!
    // - 50% leaves 640 * 0.50 - 20 = 300px (< 320px) -> collapses to centered block!
    // - 75% leaves 640 * 0.25 - 20 = 140px (< 320px) -> collapses to centered block!
    const med640_25 = resolveEditorialImageResponsivePresentation(
      "float-start",
      "25%",
      true,
      640
    );
    expect(med640_25.containerTier).toBe("medium");
    expect(med640_25.remainingTextWidthPx).toBe(460);
    expect(med640_25.isFloatCollapsed).toBe(false);
    expect(med640_25.style.float).toBe("right");

    const med640_50 = resolveEditorialImageResponsivePresentation(
      "float-start",
      "50%",
      true,
      640
    );
    expect(med640_50.containerTier).toBe("medium");
    expect(med640_50.remainingTextWidthPx).toBe(300);
    expect(med640_50.isFloatCollapsed).toBe(true);
    expect(med640_50.style.float).toBe("none");
    expect(med640_50.style.marginLeft).toBe("auto");
    expect(med640_50.canonicalLayout).toBe("float-start");

    const med640_75 = resolveEditorialImageResponsivePresentation(
      "float-end",
      "75%",
      false,
      640
    );
    expect(med640_75.containerTier).toBe("medium");
    expect(med640_75.remainingTextWidthPx).toBe(140);
    expect(med640_75.isFloatCollapsed).toBe(true);
    expect(med640_75.style.float).toBe("none");
    expect(med640_75.canonicalLayout).toBe("float-end");

    // 15c. Medium container at 768px:
    // - 25% leaves 768 * 0.75 - 20 = 556px (>= 320px) -> wraps!
    // - 50% leaves 768 * 0.50 - 20 = 364px (>= 320px) -> wraps!
    // - 75% leaves 768 * 0.25 - 20 = 172px (< 320px) -> collapses to centered block!
    const med768_25 = resolveEditorialImageResponsivePresentation(
      "float-start",
      "25%",
      false,
      768
    );
    expect(med768_25.containerTier).toBe("medium");
    expect(med768_25.remainingTextWidthPx).toBe(556);
    expect(med768_25.isFloatCollapsed).toBe(false);
    expect(med768_25.style.float).toBe("left");

    const med768_50 = resolveEditorialImageResponsivePresentation(
      "float-start",
      "50%",
      true,
      768
    );
    expect(med768_50.containerTier).toBe("medium");
    expect(med768_50.remainingTextWidthPx).toBe(364);
    expect(med768_50.isFloatCollapsed).toBe(false);
    expect(med768_50.style.float).toBe("right");

    const med768_75 = resolveEditorialImageResponsivePresentation(
      "float-start",
      "75%",
      true,
      768
    );
    expect(med768_75.containerTier).toBe("medium");
    expect(med768_75.remainingTextWidthPx).toBe(172);
    expect(med768_75.isFloatCollapsed).toBe(true);
    expect(med768_75.style.float).toBe("none");
    expect(med768_75.style.marginLeft).toBe("auto");
    expect(med768_75.canonicalLayout).toBe("float-start");
    expect(med768_75.canonicalWidth).toBe("75%");

    // 15d. Wide containers (>= 1024px): 1024 and 1440 -> honor saved canonical float layout for 25%, 50%, and 75%
    for (const wideWidth of [1024, 1440]) {
      for (const widthPreset of ["25%", "50%", "75%"] as const) {
        const rtlStart = resolveEditorialImageResponsivePresentation(
          "float-start",
          widthPreset,
          true,
          wideWidth
        );
        expect(rtlStart.containerTier).toBe("wide");
        expect(rtlStart.isFloatCollapsed).toBe(false);
        expect(rtlStart.effectiveRenderLayout).toBe("float-start");
        expect(rtlStart.style.float).toBe("right");
        expect(rtlStart.style.width).toBe(widthPreset);

        const ltrEnd = resolveEditorialImageResponsivePresentation(
          "float-end",
          widthPreset,
          false,
          wideWidth
        );
        expect(ltrEnd.containerTier).toBe("wide");
        expect(ltrEnd.isFloatCollapsed).toBe(false);
        expect(ltrEnd.effectiveRenderLayout).toBe("float-end");
        expect(ltrEnd.style.float).toBe("right");
        expect(ltrEnd.style.width).toBe(widthPreset);
      }
    }
  });
});
