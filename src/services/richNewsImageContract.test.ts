import { describe, it, expect } from "vitest";
import {
  validateRichNewsDocument,
  validateRichNewsDocumentV2,
} from "./richNewsDocumentContract";
import {
  validateRichNewsDocumentV2 as validateBackendV2,
} from "../../functions/src/shared/richNewsDocumentContract";

describe("Rich News Image Contract V2 Foundation (IMG-F2-02A)", () => {
  const validV1Doc = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "مقال تجريبي بأسلوب v1" }],
        },
      ],
    },
  };

  const validV2TextDoc = {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "مقال تجريبي بأسلوب v2 بدون صور" }],
        },
      ],
    },
  };

  const validV2ImageDoc = {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "فقرة سابقة للصورة" }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset_2026_oases_hope_001",
            altAr: "صورة توثيقية لمبادرة واحات الأمل",
            width: "50%",
            layout: "float-start",
            altEn: "Documentary photo of Oases of Hope",
            captionAr: "غروس السدر والمياه في المحمية",
            captionEn: "Sidr saplings in the reserve",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "فقرة لاحقة للصورة" }],
        },
      ],
    },
  };

  it("1. Existing valid V1 documents still pass the production validator", () => {
    const res = validateRichNewsDocument(validV1Doc);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("2. V1 rejects editorialImage", () => {
    const v1WithImage = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_001",
              altAr: "صورة",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocument(v1WithImage);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Disallowed or unknown node type: "editorialImage"'))).toBe(true);
  });

  it("3. The production V1 validator rejects V2 documents", () => {
    const res = validateRichNewsDocument(validV2TextDoc);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("expected 1, received 2"))).toBe(true);
  });

  it("4. The explicit V2 validator accepts a safe text-only V2 document", () => {
    const res = validateRichNewsDocumentV2(validV2TextDoc);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("5. The explicit V2 validator accepts a valid editorialImage asset reference", () => {
    const res = validateRichNewsDocumentV2(validV2ImageDoc);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("6. V2 rejects missing assetId", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              altAr: "صورة بدون معرف",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("assetId must be a non-empty"))).toBe(true);
  });

  it("7. V2 rejects malformed assetId containing path traversal or spaces", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "../../etc/passwd asset",
              altAr: "صورة ملوثة",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("assetId must be a non-empty path-safe string"))).toBe(true);
  });

  it("8. V2 rejects missing or blank altAr", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_valid_123",
              altAr: "   ",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("altAr must be a non-empty string"))).toBe(true);
  });

  it("9. V2 rejects invalid width", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_valid_123",
              altAr: "نص بديل",
              width: "33%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("width must be one of"))).toBe(true);
  });

  it("10. V2 rejects invalid layout", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_valid_123",
              altAr: "نص بديل",
              width: "50%",
              layout: "left",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("layout must be one of"))).toBe(true);
  });

  it("11. V2 rejects src, publicUrl, and storagePath attributes, even with HTTPS values", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_valid_123",
              src: "https://storage.googleapis.com/bucket/image.jpg",
              publicUrl: "https://example.com/image.jpg",
              storagePath: "news_media/image.jpg",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-start",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Disallowed or unknown attribute "src"'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Disallowed or unknown attribute "publicUrl"'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Disallowed or unknown attribute "storagePath"'))).toBe(true);
  });

  it("12. V2 rejects blob: and data: payloads in link marks", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "رابط خبيث",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "data:text/html,<script>alert(1)</script>",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Unsafe link URL protocol"))).toBe(true);
  });

  it("13. V2 rejects unknown image attributes (e.g. style, class, credentials)", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "editorialImage",
            attrs: {
              assetId: "asset_valid_123",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-start",
              style: "display: none;",
              class: "hidden-class",
            },
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Disallowed or unknown attribute "style"'))).toBe(true);
  });

  it("14. V2 rejects unexpected node types and malformed nesting", () => {
    const invalid = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "unsupportedScriptNode",
            content: [],
          },
        ],
      },
    };
    const res = validateRichNewsDocumentV2(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Disallowed or unknown node type"))).toBe(true);
  });

  it("15. V2 respects applicable size and complexity limits", () => {
    const hugeDoc = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: Array.from({ length: 2500 }).map(() => ({
          type: "paragraph",
          content: [{ type: "text", text: "سطر طافح" }],
        })),
      },
    };
    const res = validateRichNewsDocumentV2(hugeDoc);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Total node count"))).toBe(true);
  });

  it("16. Frontend and backend validators produce matching validation results for identical fixtures", () => {
    const resFrontend = validateRichNewsDocumentV2(validV2ImageDoc);
    const resBackend = validateBackendV2(validV2ImageDoc);
    expect(resFrontend).toEqual(resBackend);

    const invalidDoc = { schemaVersion: 2, doc: { type: "doc", content: [{ type: "editorialImage", attrs: {} }] } };
    const resFrontendBad = validateRichNewsDocumentV2(invalidDoc);
    const resBackendBad = validateBackendV2(invalidDoc);
    expect(resFrontendBad.valid).toBe(resBackendBad.valid);
    expect(resFrontendBad.errors).toEqual(resBackendBad.errors);
  });

  it("17. Validating V2 does NOT mutate the supplied document object", () => {
    const originalJson = JSON.stringify(validV2ImageDoc);
    const clonedDoc = JSON.parse(originalJson);
    Object.freeze(clonedDoc);
    Object.freeze(clonedDoc.doc);

    const res = validateRichNewsDocumentV2(clonedDoc);
    expect(res.valid).toBe(true);
    expect(JSON.stringify(clonedDoc)).toBe(originalJson);
  });

  it("18. No Firebase access is required for V2 validation", () => {
    const res = validateRichNewsDocumentV2(validV2ImageDoc);
    expect(res.valid).toBe(true);
  });
});
