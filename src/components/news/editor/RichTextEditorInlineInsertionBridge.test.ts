import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import {
  RichTextEditor,
  createProductionRichTextEditorInstance,
  createEditorialImageInsertionRequest,
  captureEditorialImageSelectionSnapshot,
  type EditorialImageInsertionRequest,
  type RichTextEditorDocumentValue,
} from "./RichTextEditor";
import {
  EditorialImageNodeView,
  resolveEditorialImageResponsivePresentation,
  computeToolbarClampedPosition,
} from "./editorialImageExtension";
import {
  validateRichNewsDocumentByVersion,
  validateRichNewsDocumentV2,
  extractPlainTextFromRichDocument,
} from "../../../services/richNewsDocumentContract";
import type {
  EditorialImageNodeAttrsV2,
  EditorialImageNodeV2,
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../../../types/richNewsDocument";

function createValidCandidateAttrs(
  overrides: Partial<EditorialImageNodeAttrsV2> = {}
): EditorialImageNodeAttrsV2 {
  return {
    assetId: "asset_news_1776000001_bridge01",
    altAr: "صورة ميدانية لمشروع الحزام الأخضر في السودان",
    altEn: "Field photo of the Green Belt project in Sudan",
    captionAr: "أعمال التشجير المجتمعي شمال الخرطوم",
    captionEn: "Community afforestation work north of Khartoum",
    width: "50%",
    layout: "float-start",
    ...overrides,
  };
}

function findPosOfSubstring(editor: any, substring: string): number {
  let foundPos = -1;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (foundPos !== -1) return false;
    if (node.isText && typeof node.text === "string") {
      const idx = node.text.indexOf(substring);
      if (idx !== -1) {
        foundPos = pos + idx;
        return false;
      }
    }
    return true;
  });
  if (foundPos === -1) {
    throw new Error(`Substring "${substring}" not found in ProseMirror doc.`);
  }
  return foundPos;
}

describe("IMG-F3-09/D2-D2B1 — Production RichTextEditor Safe Inline Image Insertion Bridge", () => {
  // 1. Valid top-level insertion in paragraph
  it("1. inserts canonical V2 editorialImage as a top-level block when cursor is inside a paragraph", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "الفقرة الأولى من التقرير البيئي." }],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "الفقرة الثانية من التقرير البيئي." }],
          },
        ],
      },
    };

    const emitted: RichTextEditorDocumentValue[] = [];
    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: (val) => emitted.push(val),
      lang: "ar",
      dir: "rtl",
    });

    const editor = harness.getEditor();
    const cursorPos = findPosOfSubstring(editor, "التقرير") + 2;
    editor.commands.setTextSelection(cursorPos);

    const request = harness.requestInsertInlineImage();
    expect(request.editorLang).toBe("ar");
    expect(request.editorDir).toBe("rtl");
    expect(request.isConsumed()).toBe(false);
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);
    expect(request.selectionSnapshot.replaceEmptyBlock).toBe(false);

    const candidateAttrs = createValidCandidateAttrs();
    const result = request.insertCanonicalImage(candidateAttrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(request.isConsumed()).toBe(true);
    expect(result.wrapper.schemaVersion).toBe(2);
    expect(result.wrapper.doc.content).toHaveLength(3);
    expect(result.wrapper.doc.content[0].type).toBe("paragraph");
    expect(result.wrapper.doc.content[1]).toEqual({
      type: "editorialImage",
      attrs: candidateAttrs,
    });
    expect(result.wrapper.doc.content[2].type).toBe("paragraph");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(result.wrapper);

    harness.destroy();
  });

  // 2. Insertion after heading
  it("2. inserts top-level editorialImage immediately after heading when cursor is inside a heading", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "عنوان المحور البيئي الأول" }],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "تفاصيل المحور الأول." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
      lang: "ar",
      dir: "rtl",
    });

    const editor = harness.getEditor();
    const posInHeading = findPosOfSubstring(editor, "المحور");
    editor.commands.setTextSelection(posInHeading);

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.targetBlockType).toBe("heading");
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrs = createValidCandidateAttrs({
      assetId: "asset_after_heading_02",
      layout: "block-center",
      width: "75%",
    });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(3);
    expect(result.wrapper.doc.content[0].type).toBe("heading");
    expect((result.wrapper.doc.content[0] as any).content[0].text).toBe(
      "عنوان المحور البيئي الأول"
    );
    expect(result.wrapper.doc.content[1]).toEqual({
      type: "editorialImage",
      attrs,
    });
    expect(result.wrapper.doc.content[2].type).toBe("paragraph");

    harness.destroy();
  });

  // 3. Nested bullet-list cursor
  it("3. resolves cursor inside a nested bulletList / listItem to a top-level editorialImage after the list", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { dir: "rtl" },
                    content: [{ type: "text", text: "البند الأول في القائمة النقطية" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { dir: "rtl" },
                    content: [{ type: "text", text: "البند الثاني في القائمة النقطية" }],
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة تلي القائمة النقطية." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    const editor = harness.getEditor();
    const posInListItem = findPosOfSubstring(editor, "البند الأول") + 4;
    editor.commands.setTextSelection(posInListItem);

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.targetBlockType).toBe("bulletList");
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrs = createValidCandidateAttrs({ assetId: "asset_bullet_list_03" });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(3);
    expect(result.wrapper.doc.content[0].type).toBe("bulletList");
    expect(result.wrapper.doc.content[1].type).toBe("editorialImage");
    expect((result.wrapper.doc.content[1] as EditorialImageNodeV2).attrs.assetId).toBe(
      "asset_bullet_list_03"
    );
    expect(result.wrapper.doc.content[2].type).toBe("paragraph");
    expect(validateRichNewsDocumentV2(result.wrapper).valid).toBe(true);

    harness.destroy();
  });

  // 4. Nested ordered-list cursor
  it("4. resolves cursor inside an orderedList / listItem to a top-level editorialImage after the ordered list", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { dir: "rtl" },
                    content: [{ type: "text", text: "الخطوة التنظيمية الأولى" }],
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة ختامية بعد الترقيم." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    const editor = harness.getEditor();
    const posInOrderedItem = findPosOfSubstring(editor, "الخطوة") + 3;
    editor.commands.setTextSelection(posInOrderedItem);

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.targetBlockType).toBe("orderedList");
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrs = createValidCandidateAttrs({ assetId: "asset_ordered_list_04" });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(3);
    expect(result.wrapper.doc.content[0].type).toBe("orderedList");
    expect(result.wrapper.doc.content[1].type).toBe("editorialImage");
    expect(result.wrapper.doc.content[2].type).toBe("paragraph");
    expect(validateRichNewsDocumentV2(result.wrapper).valid).toBe(true);

    harness.destroy();
  });

  // 5. Blockquote cursor
  it("5. resolves cursor inside a blockquote to a top-level editorialImage after the blockquote", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            attrs: { dir: "rtl" },
            content: [
              {
                type: "paragraph",
                attrs: { dir: "rtl" },
                content: [
                  {
                    type: "text",
                    text: "اقتباس علمي من هيئة الأرصاد والبيئة السودانية.",
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة تحليلية تابعة." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    const editor = harness.getEditor();
    const posInQuote = findPosOfSubstring(editor, "الأرصاد");
    editor.commands.setTextSelection(posInQuote);

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.targetBlockType).toBe("blockquote");
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrs = createValidCandidateAttrs({ assetId: "asset_blockquote_05" });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(3);
    expect(result.wrapper.doc.content[0].type).toBe("blockquote");
    expect(result.wrapper.doc.content[1].type).toBe("editorialImage");
    expect(result.wrapper.doc.content[2].type).toBe("paragraph");
    expect(validateRichNewsDocumentV2(result.wrapper).valid).toBe(true);

    harness.destroy();
  });

  // 6. Non-destructive highlighted text selection
  it("6. preserves highlighted text selection without deleting selected characters when inserting editorialImage", () => {
    const paragraphText =
      "تواجه الغابات النيلية تحديات مناخية تتطلب تدخلاً عاجلاً لحمايتها.";
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: paragraphText }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    const editor = harness.getEditor();
    const startSel = findPosOfSubstring(editor, "الغابات النيلية");
    const endSel = startSel + "الغابات النيلية تحديات مناخية".length;
    editor.commands.setTextSelection({ from: startSel, to: endSel });

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.from).toBe(startSel);
    expect(request.selectionSnapshot.to).toBe(endSel);
    expect(request.selectionSnapshot.replaceEmptyBlock).toBe(false);

    const attrs = createValidCandidateAttrs({ assetId: "asset_selection_preserve_06" });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(2);
    expect((result.wrapper.doc.content[0] as any).content[0].text).toBe(
      paragraphText
    );
    expect(extractPlainTextFromRichDocument(result.wrapper)).toBe(paragraphText);
    expect(result.wrapper.doc.content[1]).toEqual({
      type: "editorialImage",
      attrs,
    });

    harness.destroy();
  });

  // 7. Empty paragraph
  it("7. replaces an empty top-level paragraph cleanly in-place with a schema-valid top-level editorialImage", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "فقرة قبل السطر الفارغ." }],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "فقرة بعد السطر الفارغ." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    const editor = harness.getEditor();
    // Position cursor inside the second (empty) paragraph at index 1
    const firstBlockSize = editor.state.doc.child(0).nodeSize;
    const emptyParagraphInsidePos = firstBlockSize + 1;
    editor.commands.setTextSelection(emptyParagraphInsidePos);

    const request = harness.requestInsertInlineImage();
    expect(request.selectionSnapshot.replaceEmptyBlock).toBe(true);
    expect(request.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrs = createValidCandidateAttrs({ assetId: "asset_empty_para_07" });
    const result = request.insertCanonicalImage(attrs);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.wrapper.doc.content).toHaveLength(3);
    expect((result.wrapper.doc.content[0] as any).content[0].text).toBe(
      "فقرة قبل السطر الفارغ."
    );
    expect(result.wrapper.doc.content[1]).toEqual({
      type: "editorialImage",
      attrs,
    });
    expect((result.wrapper.doc.content[2] as any).content[0].text).toBe(
      "فقرة بعد السطر الفارغ."
    );

    harness.destroy();
  });

  // 8. Document start/end
  it("8. handles insertion at both document start (pos=0) and document end (pos=doc.content.size)", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة وحيدة في المستند." }],
          },
        ],
      },
    };

    // 8a. Document start (root boundary 0)
    const harnessStart = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });
    const reqStart = harnessStart.requestInsertInlineImage({ from: 0, to: 0 });
    expect(reqStart.selectionSnapshot.topLevelInsertPos).toBe(0);
    expect(reqStart.selectionSnapshot.targetBlockIndex).toBe(0);

    const attrsStart = createValidCandidateAttrs({ assetId: "asset_doc_start_08a" });
    const resStart = reqStart.insertCanonicalImage(attrsStart);
    expect(resStart.ok).toBe(true);
    if (!resStart.ok) throw new Error(resStart.error);
    expect(resStart.wrapper.doc.content[0].type).toBe("editorialImage");
    expect((resStart.wrapper.doc.content[0] as EditorialImageNodeV2).attrs.assetId).toBe(
      "asset_doc_start_08a"
    );
    expect(resStart.wrapper.doc.content[1].type).toBe("paragraph");
    harnessStart.destroy();

    // 8b. Document end (end of last paragraph / root end boundary)
    const harnessEnd = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });
    const endPos = harnessEnd.getEditor().state.doc.content.size;
    const reqEnd = harnessEnd.requestInsertInlineImage({
      from: endPos,
      to: endPos,
    });
    expect(reqEnd.selectionSnapshot.topLevelInsertPos).toBe(endPos);
    expect(reqEnd.selectionSnapshot.targetBlockIndex).toBe(1);

    const attrsEnd = createValidCandidateAttrs({ assetId: "asset_doc_end_08b" });
    const resEnd = reqEnd.insertCanonicalImage(attrsEnd);
    expect(resEnd.ok).toBe(true);
    if (!resEnd.ok) throw new Error(resEnd.error);
    expect(resEnd.wrapper.doc.content[0].type).toBe("paragraph");
    expect(resEnd.wrapper.doc.content[1].type).toBe("editorialImage");
    expect((resEnd.wrapper.doc.content[1] as EditorialImageNodeV2).attrs.assetId).toBe(
      "asset_doc_end_08b"
    );
    harnessEnd.destroy();
  });

  // 9. AR instance isolation
  it("9. isolates Arabic (AR/RTL) editor insertion from a concurrent English (EN/LTR) editor instance", () => {
    const arInitial: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "النص العربي الأصلي" }],
          },
        ],
      },
    };
    const enInitial: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "ltr", textAlign: "left" },
            content: [{ type: "text", text: "Original English body text" }],
          },
        ],
      },
    };

    const arChanges: RichTextEditorDocumentValue[] = [];
    const enChanges: RichTextEditorDocumentValue[] = [];

    const arHarness = createProductionRichTextEditorInstance({
      initialValue: arInitial,
      onChange: (val) => arChanges.push(val),
      lang: "ar",
      dir: "rtl",
    });
    const enHarness = createProductionRichTextEditorInstance({
      initialValue: enInitial,
      onChange: (val) => enChanges.push(val),
      lang: "en",
      dir: "ltr",
    });

    const arReq = arHarness.requestInsertInlineImage();
    expect(arReq.editorLang).toBe("ar");
    expect(arReq.editorDir).toBe("rtl");

    const res = arReq.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_ar_only_09" })
    );
    expect(res.ok).toBe(true);

    // Arabic editor updated to V2 with image
    expect(arHarness.getDocumentWrapper().schemaVersion).toBe(2);
    expect(arHarness.getDocumentWrapper().doc.content).toHaveLength(2);
    expect(arChanges).toHaveLength(1);

    // English editor untouched and remains V1
    expect(enHarness.getDocumentWrapper().schemaVersion).toBe(1);
    expect(enHarness.getDocumentWrapper()).toEqual(enInitial);
    expect(enChanges).toHaveLength(0);

    arHarness.destroy();
    enHarness.destroy();
  });

  // 10. EN instance isolation
  it("10. isolates English (EN/LTR) editor insertion from a concurrent Arabic (AR/RTL) editor instance", () => {
    const arInitial: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "النص العربي المستقل" }],
          },
        ],
      },
    };
    const enInitial: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "ltr", textAlign: "left" },
            content: [{ type: "text", text: "Independent English article paragraph" }],
          },
        ],
      },
    };

    const arChanges: RichTextEditorDocumentValue[] = [];
    const enChanges: RichTextEditorDocumentValue[] = [];

    const arHarness = createProductionRichTextEditorInstance({
      initialValue: arInitial,
      onChange: (val) => arChanges.push(val),
      lang: "ar",
      dir: "rtl",
    });
    const enHarness = createProductionRichTextEditorInstance({
      initialValue: enInitial,
      onChange: (val) => enChanges.push(val),
      lang: "en",
      dir: "ltr",
    });

    const enReq = enHarness.requestInsertInlineImage();
    expect(enReq.editorLang).toBe("en");
    expect(enReq.editorDir).toBe("ltr");

    const res = enReq.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_en_only_10" })
    );
    expect(res.ok).toBe(true);

    // English editor updated to V2 with image
    expect(enHarness.getDocumentWrapper().schemaVersion).toBe(2);
    expect(enHarness.getDocumentWrapper().doc.content).toHaveLength(2);
    expect(enChanges).toHaveLength(1);

    // Arabic editor untouched and remains V1
    expect(arHarness.getDocumentWrapper().schemaVersion).toBe(1);
    expect(arHarness.getDocumentWrapper()).toEqual(arInitial);
    expect(arChanges).toHaveLength(0);

    arHarness.destroy();
    enHarness.destroy();
  });

  // 11. V1 to V2 promotion
  it("11. promotes session minimumSchemaVersion from 1 to 2 upon inserting an editorialImage node", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "مسودة تبدأ بالإصدار الأول V1." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
    });

    expect(harness.session.getMinimumSchemaVersion()).toBe(1);

    const req = harness.requestInsertInlineImage();
    const res = req.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_promote_v2_11" })
    );

    expect(res.ok).toBe(true);
    expect(harness.session.getMinimumSchemaVersion()).toBe(2);
    expect(harness.getDocumentWrapper().schemaVersion).toBe(2);

    // Even after deleting the image later in the session, minimumSchemaVersion stays 2
    harness.deleteImageNodeAt(0);
    expect(harness.session.getMinimumSchemaVersion()).toBe(2);
    expect(harness.getDocumentWrapper().schemaVersion).toBe(2);

    harness.destroy();
  });

  // 12. Canonical attributes unchanged
  it("12. preserves all 7 canonical V2 editorialImage attributes without modification", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة نصية." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
    });

    const fullCanonicalAttrs: EditorialImageNodeAttrsV2 = {
      assetId: "asset_exact_7_attrs_12",
      altAr: "وصف دقيق للصورة باللغة العربية",
      altEn: "Exact English alt text",
      captionAr: "تعليق توضيحي باللغة العربية",
      captionEn: "Explanatory caption in English",
      width: "75%",
      layout: "float-end",
    };

    const req = harness.requestInsertInlineImage();
    const res = req.insertCanonicalImage(fullCanonicalAttrs);

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    expect(res.insertedAttrs).toEqual(fullCanonicalAttrs);
    const imageBlock = res.wrapper.doc.content[1] as EditorialImageNodeV2;
    expect(imageBlock.type).toBe("editorialImage");
    expect(imageBlock.attrs).toEqual(fullCanonicalAttrs);

    harness.destroy();
  });

  // 13. Invalid attrs rejected (and request remains reusable for valid retry)
  it("13. rejects invalid or forbidden attributes with INVALID_IMAGE_ATTRS without mutating the document or consuming the request", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة محمية من السمات غير الصالحة." }],
          },
        ],
      },
    };

    const onChangeSpy = vi.fn();
    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: onChangeSpy,
    });

    const req = harness.requestInsertInlineImage();

    const invalidPayloads: unknown[] = [
      null,
      {
        ...createValidCandidateAttrs(),
        altAr: "   ", // empty altAr
      },
      {
        ...createValidCandidateAttrs(),
        assetId: "blob:https://example.com/123", // forbidden blob URL
      },
      {
        ...createValidCandidateAttrs(),
        src: "https://example.com/photo.jpg", // forbidden src attribute
      },
      {
        ...createValidCandidateAttrs(),
        storagePath: "editorial_images/private/photo.jpg", // forbidden storagePath
      },
      {
        ...createValidCandidateAttrs(),
        credit: "Photographer Name", // sandbox-only credit attribute
      },
      {
        ...createValidCandidateAttrs(),
        width: "60%", // disallowed width
      },
      {
        ...createValidCandidateAttrs(),
        layout: "left", // disallowed layout
      },
    ];

    for (const invalidCandidate of invalidPayloads) {
      const res = req.insertCanonicalImage(invalidCandidate);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("Expected failure");
      expect(res.reasonCode).toBe("INVALID_IMAGE_ATTRS");
      expect(req.isConsumed()).toBe(false);
    }

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(harness.getDocumentWrapper()).toEqual(v1Doc);

    // Because validation failed before insertion, correcting the attributes on the same request succeeds
    const validRetry = req.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_corrected_after_invalid_13" })
    );
    expect(validRetry.ok).toBe(true);
    expect(req.isConsumed()).toBe(true);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);

    harness.destroy();
  });

  // 14. Stale selection rejected
  it("14. rejects insertion with STALE_SELECTION when document content changed after selection capture", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة قبل التغيير الخارجي." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
    });

    const req = harness.requestInsertInlineImage();

    // Mutate the editor document after the request was created
    harness.getEditor().commands.insertContent({
      type: "text",
      text: " نص إضافي جديد غيّر حالة المستند",
    });

    const res = req.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_stale_14" })
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("Expected STALE_SELECTION");
    expect(res.reasonCode).toBe("STALE_SELECTION");
    expect(req.isConsumed()).toBe(false);

    // Ensure no editorialImage node was inserted
    const currentWrapper = harness.getDocumentWrapper();
    expect(currentWrapper.schemaVersion).toBe(1);
    expect(
      currentWrapper.doc.content.some((n: any) => n.type === "editorialImage")
    ).toBe(false);

    harness.destroy();
  });

  // 15. Destroyed editor rejected
  it("15. rejects insertion with EDITOR_UNAVAILABLE when the target editor has been destroyed", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة في محرر سيتم إغلاقه." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
    });

    const req = harness.requestInsertInlineImage();
    harness.destroy();

    const res = req.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_destroyed_15" })
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("Expected EDITOR_UNAVAILABLE");
    expect(res.reasonCode).toBe("EDITOR_UNAVAILABLE");
    expect(req.restoreFocus()).toBe(false);
  });

  // 16. Read-only editor rejected
  it("16. rejects insertion with EDITOR_READ_ONLY when editor is in readOnly mode or becomes non-editable", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "مقال في وضع القراءة فقط." }],
          },
        ],
      },
    };

    // 16a. Initially readOnly
    const readOnlyHarness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
      readOnly: true,
    });
    const reqA = readOnlyHarness.requestInsertInlineImage();
    const resA = reqA.insertCanonicalImage(createValidCandidateAttrs());
    expect(resA.ok).toBe(false);
    if (!resA.ok) {
      expect(resA.reasonCode).toBe("EDITOR_READ_ONLY");
    }
    readOnlyHarness.destroy();

    // 16b. Editable when request created, then switched to non-editable before confirmation
    const dynamicHarness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
      readOnly: false,
    });
    const reqB = dynamicHarness.requestInsertInlineImage();
    dynamicHarness.getEditor().setEditable(false);

    const resB = reqB.insertCanonicalImage(createValidCandidateAttrs());
    expect(resB.ok).toBe(false);
    if (!resB.ok) {
      expect(resB.reasonCode).toBe("EDITOR_READ_ONLY");
    }
    dynamicHarness.destroy();
  });

  // 17. Duplicate confirmation rejected
  it("17. enforces synchronous one-shot semantics and rejects duplicate confirmation with ALREADY_CONSUMED", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة لاختبار عدم تكرار الإدراج." }],
          },
        ],
      },
    };

    const emitted: RichTextEditorDocumentValue[] = [];
    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: (val) => emitted.push(val),
    });

    const req = harness.requestInsertInlineImage();
    const attrs = createValidCandidateAttrs({ assetId: "asset_oneshot_17" });

    const firstResult = req.insertCanonicalImage(attrs);
    expect(firstResult.ok).toBe(true);
    expect(req.isConsumed()).toBe(true);

    const secondResult = req.insertCanonicalImage(attrs);
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) throw new Error("Expected ALREADY_CONSUMED");
    expect(secondResult.reasonCode).toBe("ALREADY_CONSUMED");

    const finalDoc = harness.getDocumentWrapper();
    const imageNodes = finalDoc.doc.content.filter(
      (n: any) => n.type === "editorialImage"
    );
    expect(imageNodes).toHaveLength(1);
    expect(emitted).toHaveLength(1);

    harness.destroy();
  });

  // 18. Existing document text preserved
  it("18. preserves all existing paragraphs, headings, marks, and plain-text extraction across multiple insertions", () => {
    const initialDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "عنوان رئيسي للتقرير" }],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [
              { type: "text", text: "بداية الفقرة مع " },
              {
                type: "text",
                text: "نص عريض",
                marks: [{ type: "bold" }],
              },
              { type: "text", text: " ونهاية الفقرة الأولى." },
            ],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "الفقرة الختامية الكاملة." }],
          },
        ],
      },
    };

    const expectedPlainText = extractPlainTextFromRichDocument(initialDoc);
    const harness = createProductionRichTextEditorInstance({
      initialValue: initialDoc,
      onChange: vi.fn(),
    });

    // Insert image after first paragraph
    const posInFirstPara = findPosOfSubstring(harness.getEditor(), "نص عريض");
    harness.getEditor().commands.setTextSelection(posInFirstPara);

    const req1 = harness.requestInsertInlineImage();
    const res1 = req1.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_multi_18_a" })
    );
    expect(res1.ok).toBe(true);

    // Insert second image after final paragraph
    const posInLastPara = findPosOfSubstring(harness.getEditor(), "الختامية");
    harness.getEditor().commands.setTextSelection(posInLastPara);

    const req2 = harness.requestInsertInlineImage();
    const res2 = req2.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_multi_18_b", layout: "block-full", width: "100%" })
    );
    expect(res2.ok).toBe(true);

    const finalDoc = harness.getDocumentWrapper();
    expect(finalDoc.schemaVersion).toBe(2);
    expect(finalDoc.doc.content.map((n: any) => n.type)).toEqual([
      "heading",
      "paragraph",
      "editorialImage",
      "paragraph",
      "editorialImage",
    ]);
    expect(extractPlainTextFromRichDocument(finalDoc)).toBe(expectedPlainText);
    expect(validateRichNewsDocumentByVersion(finalDoc).valid).toBe(true);

    harness.destroy();
  });

  // 19. No preview URL persisted
  it("19. never persists runtime previewUrlsByAssetId or blob: URLs into canonical V2 document JSON", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "فقرة مع معاينة محلية في الذاكرة فقط." }],
          },
        ],
      },
    };

    const runtimePreviewMap = {
      asset_runtime_preview_19: "blob:https://promiseofplanet.org/99887766-5544",
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
      previewUrlsByAssetId: runtimePreviewMap,
      getPreviewUrl: (id) => runtimePreviewMap[id as keyof typeof runtimePreviewMap],
    });

    const req = harness.requestInsertInlineImage();
    const res = req.insertCanonicalImage(
      createValidCandidateAttrs({ assetId: "asset_runtime_preview_19" })
    );

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const serialized = JSON.stringify(res.wrapper);
    expect(serialized).not.toContain("blob:");
    expect(serialized).not.toContain("previewUrl");
    expect(serialized).not.toContain("src");
    expect(serialized).not.toContain("storagePath");

    const imageNode = res.wrapper.doc.content[1] as EditorialImageNodeV2;
    expect(Object.keys(imageNode.attrs).sort()).toEqual(
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

    harness.destroy();
  });

  // 20. Existing image layout controls, responsive rules, and toolbar trigger visibility unaffected
  it("20. preserves existing image layout/width controls and renders toolbar trigger only when onRequestInsertInlineImage is provided and editable", () => {
    const v1Doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "فقرة لاختبار أدوات التحكم بالصورة." }],
          },
        ],
      },
    };

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: vi.fn(),
    });

    const req = harness.requestInsertInlineImage();
    const res = req.insertCanonicalImage(
      createValidCandidateAttrs({
        assetId: "asset_controls_20",
        width: "50%",
        layout: "float-start",
      })
    );
    expect(res.ok).toBe(true);

    // Verify existing width and layout actions operate on the newly inserted image node
    harness.createImageNodeActions(0).handleSetWidth("75%");
    harness.createImageNodeActions(0).handleSetLayout("float-end");

    const updatedDoc = harness.getDocumentWrapper() as RichNewsDocumentWrapperV2;
    const updatedImage = updatedDoc.doc.content[1] as EditorialImageNodeV2;
    expect(updatedImage.attrs.width).toBe("75%");
    expect(updatedImage.attrs.layout).toBe("float-end");

    // Verify responsive presentation & toolbar clamping helpers remain intact
    const mobilePresentation = resolveEditorialImageResponsivePresentation(
      updatedImage.attrs.layout,
      updatedImage.attrs.width,
      true,
      375
    );
    expect(mobilePresentation.isFloatCollapsed).toBe(true);
    expect(mobilePresentation.effectiveRenderLayout).toBe("block-center");
    expect(mobilePresentation.canonicalLayout).toBe("float-end");
    expect(mobilePresentation.canonicalWidth).toBe("75%");

    const clampedToolbar = computeToolbarClampedPosition({
      figureRect: { top: 100, bottom: 260, left: 0, right: 350, width: 350 },
      editorRect: { top: 80, bottom: 500, left: 0, right: 375, width: 375 },
      toolbarWidth: 320,
      toolbarHeight: 40,
    });
    expect(clampedToolbar.clampedLeft).toBeGreaterThanOrEqual(8);

    // Verify React RichTextEditor toolbar button conditional rendering
    const htmlWithoutCallback = renderToStaticMarkup(
      React.createElement(RichTextEditor, {
        value: v1Doc,
        onChange: vi.fn(),
        lang: "ar",
        dir: "rtl",
      })
    );
    expect(htmlWithoutCallback).not.toContain('data-testid="rte-insert-inline-image-btn"');

    const htmlWithCallback = renderToStaticMarkup(
      React.createElement(RichTextEditor, {
        value: v1Doc,
        onChange: vi.fn(),
        lang: "ar",
        dir: "rtl",
        onRequestInsertInlineImage: vi.fn(),
      })
    );
    expect(htmlWithCallback).toContain('data-testid="rte-insert-inline-image-btn"');

    const htmlReadOnlyWithCallback = renderToStaticMarkup(
      React.createElement(RichTextEditor, {
        value: v1Doc,
        onChange: vi.fn(),
        lang: "ar",
        dir: "rtl",
        readOnly: true,
        onRequestInsertInlineImage: vi.fn(),
      })
    );
    expect(htmlReadOnlyWithCallback).not.toContain('data-testid="rte-insert-inline-image-btn"');

    // Verify helper captureEditorialImageSelectionSnapshot and createEditorialImageInsertionRequest are directly callable
    const directSnapshot = captureEditorialImageSelectionSnapshot(harness.getEditor());
    expect(directSnapshot.docChildCount).toBe(2);
    const directReq: EditorialImageInsertionRequest = createEditorialImageInsertionRequest({
      editor: harness.getEditor(),
      session: harness.session,
    });
    expect(directReq.restoreFocus()).toBe(true);

    // Ensure EditorialImageNodeView still renders cleanly
    expect(typeof EditorialImageNodeView).toBe("function");

    harness.destroy();
  });
});
