import { describe, it, expect } from "vitest";
import {
  richDocumentToTiptapJson,
  richDocumentV2ToTiptapJson,
  richDocumentToTiptapJsonByVersion,
  tiptapJsonToRichDocument,
  tiptapJsonToRichDocumentV2,
  tiptapJsonToRichDocumentByVersion,
  type TiptapDocJson,
} from "./richNewsTiptapAdapter";
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../types/richNewsDocument";

function createValidV1Wrapper(): RichNewsDocumentWrapper {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: "right" },
          content: [{ type: "text", text: "عنوان المقال" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [
            { type: "text", text: "Introductory text with " },
            {
              type: "text",
              text: "formatting",
              marks: [{ type: "bold" }, { type: "italic" }],
            },
          ],
        },
      ],
    },
  };
}

function createValidV2Wrapper(): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "فقرة افتتاحية قبل الصورة" }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "media-asset-2026-009",
            altAr: "صورة ميدانية لمشروع التشجير",
            altEn: "Field photo of the afforestation project",
            captionAr: "توثيق المرحلة الأولى",
            captionEn: "Phase 1 documentation",
            width: "75%",
            layout: "float-end",
          },
        },
        {
          type: "paragraph",
          attrs: { textAlign: "justify" },
          content: [{ type: "text", text: "Closing paragraph after the editorial image." }],
        },
      ],
    },
  };
}

describe("IMG-F3-09/D1-C1 — Version-Aware Tiptap Adapter Convergence", () => {
  it("1. V1 rich document -> Tiptap JSON matches existing V1 adapter output", () => {
    const v1Wrapper = createValidV1Wrapper();
    const expected = richDocumentToTiptapJson(v1Wrapper);
    const actual = richDocumentToTiptapJsonByVersion(v1Wrapper);

    expect(actual).toEqual(expected);
  });

  it("2. V2 rich document with editorialImage -> Tiptap JSON matches existing V2 adapter output", () => {
    const v2Wrapper = createValidV2Wrapper();
    const expected = richDocumentV2ToTiptapJson(v2Wrapper);
    const actual = richDocumentToTiptapJsonByVersion(v2Wrapper);

    expect(actual).toEqual(expected);
    expect(actual.content?.[1]).toEqual({
      type: "editorialImage",
      attrs: {
        assetId: "media-asset-2026-009",
        altAr: "صورة ميدانية لمشروع التشجير",
        altEn: "Field photo of the afforestation project",
        captionAr: "توثيق المرحلة الأولى",
        captionEn: "Phase 1 documentation",
        width: "75%",
        layout: "float-end",
      },
    });
  });

  it("3. Tiptap text-only document -> V1 wrapper by default", () => {
    const tiptapDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3, textAlign: null },
          content: [{ type: "text", text: "Section Heading" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: [{ type: "text", text: "محتوى نصي فقط بدون صور" }],
        },
      ],
    };

    const result = tiptapJsonToRichDocumentByVersion(tiptapDoc);
    const expectedV1 = tiptapJsonToRichDocument(tiptapDoc);

    expect(result.schemaVersion).toBe(1);
    expect(result).toEqual(expectedV1);
  });

  it("4. Tiptap document containing editorialImage -> V2 wrapper", () => {
    const tiptapDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: null },
          content: [{ type: "text", text: "Leading paragraph" }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset-inline-101",
            altAr: "وصف الصورة",
            altEn: "Image alt text",
            captionAr: null,
            captionEn: "English caption only",
            width: "50%",
            layout: "float-start",
          },
        },
      ],
    };

    const result = tiptapJsonToRichDocumentByVersion(tiptapDoc);
    const expectedV2 = tiptapJsonToRichDocumentV2(tiptapDoc);

    expect(result.schemaVersion).toBe(2);
    expect(result).toEqual(expectedV2);
  });

  it("5. Tiptap text-only document with minimumSchemaVersion: 2 -> V2 wrapper", () => {
    const tiptapDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [{ type: "text", text: "Centered text upgraded to V2" }],
        },
      ],
    };

    const result = tiptapJsonToRichDocumentByVersion(tiptapDoc, 2);
    const expectedV2 = tiptapJsonToRichDocumentV2(tiptapDoc);

    expect(result.schemaVersion).toBe(2);
    expect(result).toEqual(expectedV2);
  });

  it("6. Preserves all canonical editorialImage attributes across round-trip conversion", () => {
    const v2Wrapper = createValidV2Wrapper();
    const tiptapDoc = richDocumentToTiptapJsonByVersion(v2Wrapper);
    const roundTripped = tiptapJsonToRichDocumentByVersion(tiptapDoc);

    expect(roundTripped.schemaVersion).toBe(2);
    expect(roundTripped).toEqual(v2Wrapper);

    const imageNode = roundTripped.doc.content[1];
    expect(imageNode.type).toBe("editorialImage");
    if (imageNode.type === "editorialImage") {
      expect(imageNode.attrs).toEqual({
        assetId: "media-asset-2026-009",
        altAr: "صورة ميدانية لمشروع التشجير",
        altEn: "Field photo of the afforestation project",
        captionAr: "توثيق المرحلة الأولى",
        captionEn: "Phase 1 documentation",
        width: "75%",
        layout: "float-end",
      });
    }
  });

  it("7. Rejects missing schemaVersion, schemaVersion: 0, schemaVersion: 3, or non-object wrappers", () => {
    const missingVersion = {
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    } as unknown as RichNewsDocumentWrapper;

    const versionZero = {
      schemaVersion: 0,
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    } as unknown as RichNewsDocumentWrapper;

    const versionThree = {
      schemaVersion: 3,
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    } as unknown as RichNewsDocumentWrapper;

    expect(() => richDocumentToTiptapJsonByVersion(missingVersion)).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() => richDocumentToTiptapJsonByVersion(versionZero)).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() => richDocumentToTiptapJsonByVersion(versionThree)).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() =>
      richDocumentToTiptapJsonByVersion(null as unknown as RichNewsDocumentWrapper)
    ).toThrow(/TIPTAP_ADAPTER_ERROR/);
  });

  it("8. Rejects editorialImage inside a V1 wrapper", () => {
    const v1WithEditorialImage = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset-v1-illegal",
              altAr: "وصف الصورة",
              altEn: "Image alt",
              width: "100%",
              layout: "block-full",
            },
          },
        ],
      },
    } as unknown as RichNewsDocumentWrapper;

    expect(() => richDocumentToTiptapJsonByVersion(v1WithEditorialImage)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
  });

  it("9. Rejects raw image node in both directions", () => {
    const rawImageTiptap: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/photo.jpg" },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentByVersion(rawImageTiptap)).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() => tiptapJsonToRichDocumentByVersion(rawImageTiptap, 2)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );

    const rawImageV2Wrapper = {
      schemaVersion: 2,
      doc: rawImageTiptap,
    } as unknown as RichNewsDocumentWrapperV2;

    expect(() => richDocumentToTiptapJsonByVersion(rawImageV2Wrapper)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
  });

  it("10. Rejects editorialImage with src, publicUrl, storagePath, alignment, title, or credit", () => {
    const forbiddenAttrs = [
      { src: "https://cdn.example.com/img.png" },
      { publicUrl: "https://storage.googleapis.com/bucket/img.png" },
      { storagePath: "news/assets/img.png" },
      { alignment: "left" },
      { title: "Forbidden title attribute" },
      { credit: "Forbidden photographer credit" },
    ];

    for (const extraAttr of forbiddenAttrs) {
      const tiptapWithForbiddenAttr: TiptapDocJson = {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset-valid-id",
              altAr: "وصف الصورة",
              altEn: "Valid English alt",
              width: "100%",
              layout: "block-full",
              ...extraAttr,
            },
          },
        ],
      };

      expect(() => tiptapJsonToRichDocumentByVersion(tiptapWithForbiddenAttr)).toThrow(
        /TIPTAP_ADAPTER_ERROR/
      );

      const wrapperWithForbiddenAttr = {
        schemaVersion: 2,
        doc: tiptapWithForbiddenAttr,
      } as unknown as RichNewsDocumentWrapperV2;

      expect(() => richDocumentToTiptapJsonByVersion(wrapperWithForbiddenAttr)).toThrow(
        /TIPTAP_ADAPTER_ERROR/
      );
    }
  });

  it("11. Rejects editorialImage with missing assetId, invalid width, or invalid layout", () => {
    const missingAssetIdDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            altAr: "وصف الصورة",
            altEn: "Valid English alt",
            width: "50%",
            layout: "block-center",
          },
        },
      ],
    };

    const invalidWidthDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset-123",
            altAr: "وصف الصورة",
            altEn: "Valid English alt",
            width: "60%",
            layout: "block-center",
          },
        },
      ],
    };

    const invalidLayoutDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset-123",
            altAr: "وصف الصورة",
            altEn: "Valid English alt",
            width: "50%",
            layout: "inline-left",
          },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentByVersion(missingAssetIdDoc)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
    expect(() => tiptapJsonToRichDocumentByVersion(invalidWidthDoc)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
    expect(() => tiptapJsonToRichDocumentByVersion(invalidLayoutDoc)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
  });

  it("12. Rejects editorialImage nested inside paragraph, blockquote, or listItem", () => {
    const nestedInParagraph: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "editorialImage",
              attrs: {
                assetId: "asset-nested-p",
                altAr: "وصف الصورة",
                altEn: "Valid English alt",
                width: "50%",
                layout: "block-center",
              },
            },
          ],
        },
      ],
    };

    const nestedInBlockquote: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "editorialImage",
              attrs: {
                assetId: "asset-nested-bq",
                altAr: "وصف الصورة",
                altEn: "Valid English alt",
                width: "50%",
                layout: "block-center",
              },
            },
          ],
        },
      ],
    };

    const nestedInListItem: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "editorialImage",
                  attrs: {
                    assetId: "asset-nested-li",
                    altAr: "وصف الصورة",
                    altEn: "Valid English alt",
                    width: "50%",
                    layout: "block-center",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentByVersion(nestedInParagraph)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
    expect(() => tiptapJsonToRichDocumentByVersion(nestedInBlockquote)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );
    expect(() => tiptapJsonToRichDocumentByVersion(nestedInListItem)).toThrow(
      /TIPTAP_ADAPTER_ERROR/
    );

    expect(() =>
      richDocumentToTiptapJsonByVersion({
        schemaVersion: 2,
        doc: nestedInParagraph,
      } as unknown as RichNewsDocumentWrapperV2)
    ).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() =>
      richDocumentToTiptapJsonByVersion({
        schemaVersion: 2,
        doc: nestedInBlockquote,
      } as unknown as RichNewsDocumentWrapperV2)
    ).toThrow(/TIPTAP_ADAPTER_ERROR/);
    expect(() =>
      richDocumentToTiptapJsonByVersion({
        schemaVersion: 2,
        doc: nestedInListItem,
      } as unknown as RichNewsDocumentWrapperV2)
    ).toThrow(/TIPTAP_ADAPTER_ERROR/);
  });

  it("13. Does not mutate input objects in either conversion direction", () => {
    const v1Input = createValidV1Wrapper();
    const v1Snapshot = JSON.stringify(v1Input);
    const v1TiptapOut = richDocumentToTiptapJsonByVersion(v1Input);
    v1TiptapOut.content?.push({ type: "paragraph", content: [{ type: "text", text: "Mutated" }] });
    if (v1TiptapOut.content?.[0]?.attrs) {
      v1TiptapOut.content[0].attrs.level = 4;
    }
    expect(JSON.stringify(v1Input)).toBe(v1Snapshot);

    const v2Input = createValidV2Wrapper();
    const v2Snapshot = JSON.stringify(v2Input);
    const v2TiptapOut = richDocumentToTiptapJsonByVersion(v2Input);
    if (v2TiptapOut.content?.[1]?.attrs) {
      v2TiptapOut.content[1].attrs.width = "25%";
    }
    expect(JSON.stringify(v2Input)).toBe(v2Snapshot);

    const tiptapV2Input: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: null },
          content: [{ type: "text", text: "Immutable Tiptap input" }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset-imm-1",
            altAr: "وصف الصورة الثابت",
            altEn: "Immutable alt",
            captionAr: null,
            captionEn: null,
            width: "50%",
            layout: "block-center",
          },
        },
      ],
    };
    const tiptapSnapshot = JSON.stringify(tiptapV2Input);
    const convertedWrapper = tiptapJsonToRichDocumentByVersion(tiptapV2Input);
    expect(JSON.stringify(tiptapV2Input)).toBe(tiptapSnapshot);

    if (convertedWrapper.doc.content[1]?.type === "editorialImage") {
      convertedWrapper.doc.content[1].attrs.width = "100%";
    }
    expect(JSON.stringify(tiptapV2Input)).toBe(tiptapSnapshot);
  });
});
