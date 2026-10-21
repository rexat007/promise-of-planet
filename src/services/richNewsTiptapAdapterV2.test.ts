import { describe, it, expect } from "vitest";
import {
  tiptapJsonToRichDocument,
  richDocumentToTiptapJson,
  tiptapJsonToRichDocumentV2,
  richDocumentV2ToTiptapJson,
  type TiptapDocJson,
} from "./richNewsTiptapAdapter";
import type { RichNewsDocumentWrapperV2 } from "../types/richNewsDocument";

describe("richNewsTiptapAdapterV2 - Safe V2 Tiptap Document Adapter", () => {
  // 1. V1 adapter accepts a valid V1 text document.
  it("V1 adapter accepts a valid V1 text document", () => {
    const tiptapV1: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "نص عربي تجريبي" }],
        },
      ],
    };

    const wrapperV1 = tiptapJsonToRichDocument(tiptapV1);
    expect(wrapperV1.schemaVersion).toBe(1);
    expect(wrapperV1.doc.content).toHaveLength(1);

    const restored = richDocumentToTiptapJson(wrapperV1);
    expect(restored.type).toBe("doc");
    expect(restored.content).toEqual(tiptapV1.content);
  });

  // 2. V1 adapter still rejects editorialImage.
  it("V1 adapter still rejects editorialImage", () => {
    const tiptapWithImage: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset-123",
            altAr: "صورة تجريبية",
            width: "50%",
            layout: "float-start",
          },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(tiptapWithImage)).toThrowError(/Disallowed or unknown node type/);
  });

  // 3. Valid V2 text-only document round-trips.
  it("Valid V2 text-only document round-trips", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "ltr" },
          content: [{ type: "text", text: "Hello V2 World" }],
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect(wrapperV2.schemaVersion).toBe(2);

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect(restored).toEqual(tiptapV2);
  });

  // 4. V2 document with one editorialImage round-trips.
  it("V2 document with one editorialImage round-trips", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "img-001",
            altAr: "وصف الصورة بالعربية",
            width: "50%",
            layout: "float-start",
            altEn: "English alt text",
            captionAr: "تعليق عربي",
            captionEn: "English caption",
          },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect(wrapperV2.schemaVersion).toBe(2);
    expect(wrapperV2.doc.content[0].type).toBe("editorialImage");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect(restored).toEqual(tiptapV2);
  });

  // 5. Multiple images preserve count and ordering.
  it("Multiple images preserve count and ordering", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: { assetId: "img-first", altAr: "الأولى", width: "25%", layout: "float-start" },
        },
        {
          type: "editorialImage",
          attrs: { assetId: "img-second", altAr: "الثانية", width: "75%", layout: "block-center" },
        },
        {
          type: "editorialImage",
          attrs: { assetId: "img-third", altAr: "الثالثة", width: "100%", layout: "block-full" },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect(wrapperV2.doc.content).toHaveLength(3);
    expect((wrapperV2.doc.content[0] as any).attrs.assetId).toBe("img-first");
    expect((wrapperV2.doc.content[1] as any).attrs.assetId).toBe("img-second");
    expect((wrapperV2.doc.content[2] as any).attrs.assetId).toBe("img-third");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect(restored.content).toHaveLength(3);
  });

  // 6. Mixed paragraphs and images preserve ordering.
  it("Mixed paragraphs and images preserve ordering", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "الفقرة الأولى" }],
        },
        {
          type: "editorialImage",
          attrs: { assetId: "asset-mid", altAr: "صورة في المنتصف", width: "50%", layout: "float-end" },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "الفقرة الثانية" }],
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect(wrapperV2.doc.content[0].type).toBe("paragraph");
    expect(wrapperV2.doc.content[1].type).toBe("editorialImage");
    expect(wrapperV2.doc.content[2].type).toBe("paragraph");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect(restored).toEqual(tiptapV2);
  });

  // 7. assetId remains unchanged.
  it("assetId remains unchanged", () => {
    const assetId = "unique_asset_id_9988-ABC_xyz";
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: { assetId, altAr: "تنسيق مخصص", width: "100%", layout: "block-full" },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect((wrapperV2.doc.content[0] as any).attrs.assetId).toBe(assetId);

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect((restored.content?.[0] as any).attrs.assetId).toBe(assetId);
  });

  // 8. Width and layout remain unchanged.
  it("Width and layout remain unchanged", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: { assetId: "a1", altAr: "صورة", width: "75%", layout: "float-end" },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect((wrapperV2.doc.content[0] as any).attrs.width).toBe("75%");
    expect((wrapperV2.doc.content[0] as any).attrs.layout).toBe("float-end");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect((restored.content?.[0] as any).attrs.width).toBe("75%");
    expect((restored.content?.[0] as any).attrs.layout).toBe("float-end");
  });

  // 9. Arabic and English alternative text are preserved.
  it("Arabic and English alternative text are preserved", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a2",
            altAr: "نص بديل عربي",
            altEn: "English Alt Text",
            width: "50%",
            layout: "block-center",
          },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect((wrapperV2.doc.content[0] as any).attrs.altAr).toBe("نص بديل عربي");
    expect((wrapperV2.doc.content[0] as any).attrs.altEn).toBe("English Alt Text");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect((restored.content?.[0] as any).attrs.altAr).toBe("نص بديل عربي");
    expect((restored.content?.[0] as any).attrs.altEn).toBe("English Alt Text");
  });

  // 10. Captions remain unchanged.
  it("Captions remain unchanged", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a3",
            altAr: "صورة مع تعليق",
            width: "50%",
            layout: "float-start",
            captionAr: "شرح توضيحي عربي",
            captionEn: "Detailed English caption",
          },
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    expect((wrapperV2.doc.content[0] as any).attrs.captionAr).toBe("شرح توضيحي عربي");
    expect((wrapperV2.doc.content[0] as any).attrs.captionEn).toBe("Detailed English caption");

    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect((restored.content?.[0] as any).attrs.captionAr).toBe("شرح توضيحي عربي");
    expect((restored.content?.[0] as any).attrs.captionEn).toBe("Detailed English caption");
  });

  // 11. Existing text formatting and link marks remain intact.
  it("Existing text formatting and link marks remain intact", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "نص ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "رابط مهم",
              marks: [{ type: "link", attrs: { href: "https://example.com/article" } }],
            },
          ],
        },
      ],
    };

    const wrapperV2 = tiptapJsonToRichDocumentV2(tiptapV2);
    const restored = richDocumentV2ToTiptapJson(wrapperV2);
    expect(restored).toEqual(tiptapV2);
  });

  // 12. Missing assetId is rejected.
  it("Missing assetId is rejected", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            altAr: "بدون معرف",
            width: "50%",
            layout: "float-start",
          },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/assetId must be a non-empty path-safe string/);
  });

  // 13. Malformed assetId is rejected.
  it("Malformed assetId is rejected", () => {
    const invalidAssetIds = ["asset with spaces", "asset/slash", "asset<tag>", "../path-traversal"];
    for (const assetId of invalidAssetIds) {
      const tiptapV2: TiptapDocJson = {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: { assetId, altAr: "تنسيق خاطئ", width: "50%", layout: "float-start" },
          },
        ],
      };
      expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/assetId must be a non-empty path-safe string/);
    }
  });

  // 14. Invalid width is rejected.
  it("Invalid width is rejected", () => {
    const invalidWidths = ["30%", "50px", "auto", "100"];
    for (const width of invalidWidths) {
      const tiptapV2: TiptapDocJson = {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: { assetId: "a1", altAr: "عرض غير صالح", width, layout: "float-start" },
          },
        ],
      };
      expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/width must be one of: 25%, 50%, 75%, 100%/);
    }
  });

  // 15. Invalid layout is rejected.
  it("Invalid layout is rejected", () => {
    const invalidLayouts = ["left", "right", "center", "inline", "flex"];
    for (const layout of invalidLayouts) {
      const tiptapV2: TiptapDocJson = {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: { assetId: "a1", altAr: "تخطيط غير صالح", width: "50%", layout },
          },
        ],
      };
      expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/layout must be one of: float-start, float-end, block-center, block-full/);
    }
  });

  // 16. Image src, even HTTPS, is rejected.
  it("Image src, even HTTPS, is rejected", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a1",
            altAr: "صورة برابط",
            width: "50%",
            layout: "float-start",
            src: "https://example.com/image.png",
          },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/Disallowed or unknown attribute "src"/);
  });

  // 17. blob: and data: image URLs are rejected.
  it("blob: and data: image URLs are rejected", () => {
    const blobDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a1",
            altAr: "صورة blob",
            width: "50%",
            layout: "float-start",
            src: "blob:http://localhost:3000/1234-5678",
          },
        },
      ],
    };
    expect(() => tiptapJsonToRichDocumentV2(blobDoc)).toThrowError(/Disallowed or unknown attribute "src"/);

    const dataDoc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a1",
            altAr: "صورة data",
            width: "50%",
            layout: "float-start",
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        },
      ],
    };
    expect(() => tiptapJsonToRichDocumentV2(dataDoc)).toThrowError(/Disallowed or unknown attribute "src"/);
  });

  // 18. storagePath, publicUrl and downloadUrl are rejected.
  it("storagePath, publicUrl and downloadUrl are rejected", () => {
    const forbiddenKeys = ["storagePath", "publicUrl", "downloadUrl"];
    for (const key of forbiddenKeys) {
      const tiptapV2: TiptapDocJson = {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "a1",
              altAr: "صورة مع خاصية ممنوعة",
              width: "50%",
              layout: "float-start",
              [key]: "https://firebasestorage.googleapis.com/v0/b/...",
            },
          },
        ],
      };
      expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(
        new RegExp(`Disallowed or unknown attribute "${key}"`)
      );
    }
  });

  // 19. Unknown image attributes are rejected rather than removed.
  it("Unknown image attributes are rejected rather than removed", () => {
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: {
            assetId: "a1",
            altAr: "صورة مع خاصية مجهولة",
            width: "50%",
            layout: "float-start",
            customAttr: "value",
            src: null,
          },
        },
      ],
    };

    expect(() => tiptapJsonToRichDocumentV2(tiptapV2)).toThrowError(/Disallowed or unknown attribute/);
  });

  // 20. Invalid root document or malformed node structure is rejected.
  it("Invalid root document or malformed node structure is rejected", () => {
    expect(() => tiptapJsonToRichDocumentV2(null as any)).toThrowError(/Invalid Tiptap document/);
    expect(() => tiptapJsonToRichDocumentV2({ type: "paragraph" } as any)).toThrowError(/Invalid Tiptap document/);

    const malformedContent: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: "not an object" as any,
        },
      ],
    };
    expect(() => tiptapJsonToRichDocumentV2(malformedContent)).toThrowError(/editorialImage node requires an attrs object/);
  });

  // 21. Input document remains unchanged after conversion.
  it("Input document remains unchanged after conversion", () => {
    const input: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: null, textAlign: null },
          content: [{ type: "text", text: "عدم تعديل المدخلات" }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "a1",
            altAr: "اختبار عدم التغيير",
            width: "50%",
            layout: "float-start",
            altEn: null,
          },
        },
      ],
    };

    const inputSnapshot = JSON.stringify(input);
    tiptapJsonToRichDocumentV2(input);
    expect(JSON.stringify(input)).toBe(inputSnapshot);
  });

  // 22. Mutating returned JSON does not mutate the original wrapper.
  it("Mutating returned JSON does not mutate the original wrapper", () => {
    const wrapper: RichNewsDocumentWrapperV2 = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "a1",
              altAr: "الأصلية",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };

    const wrapperSnapshot = JSON.stringify(wrapper);
    const restored = richDocumentV2ToTiptapJson(wrapper);

    // Mutate returned JSON
    (restored.content?.[0] as any).attrs.altAr = "معدلة بعد الإرجاع";

    expect(JSON.stringify(wrapper)).toBe(wrapperSnapshot);
    expect((wrapper.doc.content[0] as any).attrs.altAr).toBe("الأصلية");
  });

  // 23. V2 conversion does not activate V2 in the legacy V1 adapter.
  it("V2 conversion does not activate V2 in the legacy V1 adapter", () => {
    const v2Doc: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: { assetId: "a1", altAr: "صورة V2", width: "50%", layout: "float-start" },
        },
      ],
    };

    // V2 adapter succeeds
    const wrapperV2 = tiptapJsonToRichDocumentV2(v2Doc);
    expect(wrapperV2.schemaVersion).toBe(2);

    // V1 adapter still throws when given V2 Tiptap JSON containing image
    expect(() => tiptapJsonToRichDocument(v2Doc)).toThrowError(/Disallowed or unknown node type/);

    // V1 adapter still throws when given V2 document wrapper
    expect(() => richDocumentToTiptapJson(wrapperV2 as any)).toThrowError(
      /Unsupported or missing schemaVersion: expected 1, received 2/
    );
  });

  // 24. No Firebase, network, browser storage, or asset resolution is necessary.
  it("No Firebase, network, browser storage, or asset resolution is necessary", () => {
    // Pure offline transformation test without any global state, network calls, or browser storage dependencies
    const tiptapV2: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "editorialImage",
          attrs: { assetId: "pure-offline-id", altAr: "بدون شبكة", width: "100%", layout: "block-full" },
        },
      ],
    };

    const wrapper = tiptapJsonToRichDocumentV2(tiptapV2);
    expect(wrapper.schemaVersion).toBe(2);
    const restored = richDocumentV2ToTiptapJson(wrapper);
    expect(restored).toEqual(tiptapV2);
  });
});
