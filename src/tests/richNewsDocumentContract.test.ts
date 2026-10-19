// @ts-ignore
import { describe, it, expect } from "vitest";
import type { RichNewsDocumentWrapper } from "../types/richNewsDocument";
import {
  validateRichNewsDocument,
  convertPlainTextToRichDocument,
  extractPlainTextFromRichDocument,
  serializeRichDocument,
  parseRichDocument,
} from "../services/richNewsDocumentContract";

describe("RichNewsDocumentContract Foundation Unit Tests", () => {
  it("1. Validates a standard valid rich news document wrapper", () => {
    const doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, dir: "rtl", textAlign: "right" },
            content: [{ type: "text", text: "أزمة المناخ في السودان" }],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [
              { type: "text", text: "تقرير ميداني عن الموارد المائية ", marks: [{ type: "bold" }] },
              {
                type: "text",
                text: "رابط الوزارة",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.gov.sd", target: "_blank", rel: "noopener" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("2. Validates headings (H2-H4) and nested ordered/bullet lists", () => {
    const doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3, dir: "ltr" },
            content: [{ type: "text", text: "Key Environmental Initiatives" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { dir: "ltr" },
                    content: [{ type: "text", text: "Water resource management" }],
                  },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { dir: "ltr" },
                    content: [{ type: "text", text: "Phase 1: Assessment" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(doc);
    expect(result.valid).toBe(true);
  });

  it("3. Handles mixed Arabic and English paragraphs with direction attributes", () => {
    const doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "تقرير خاص عن حوض النيل" }],
          },
          {
            type: "paragraph",
            attrs: { dir: "ltr" },
            content: [{ type: "text", text: "Special Report on the Nile Basin" }],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(doc);
    expect(result.valid).toBe(true);
  });

  it("4. Converts legacy plain text to rich document and verifies round-trip extraction", () => {
    const plainText = "العنوان الأول\n\nفقرة أولى تحتوي التفاصيل.\nسطر ثاني داخل الفقرة الأولى.\n\nفقرة ثانية مستقلة.";

    const richDoc = convertPlainTextToRichDocument(plainText);
    expect(richDoc.schemaVersion).toBe(1);
    expect(richDoc.doc.content.length).toBe(3);

    const validation = validateRichNewsDocument(richDoc);
    expect(validation.valid).toBe(true);

    const extractedText = extractPlainTextFromRichDocument(richDoc);
    expect(extractedText).toBe(plainText);
  });

  it("5. Handles empty documents gracefully", () => {
    const emptyDoc = convertPlainTextToRichDocument("");
    expect(emptyDoc.schemaVersion).toBe(1);
    expect(emptyDoc.doc.content).toHaveLength(0);

    const result = validateRichNewsDocument(emptyDoc);
    expect(result.valid).toBe(true);

    const extracted = extractPlainTextFromRichDocument(emptyDoc);
    expect(extracted).toBe("");
  });

  it("6. Rejects disallowed or unknown node types (e.g. image, video, script, iframe)", () => {
    const docWithImage = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://example.com/photo.jpg" },
          },
          {
            type: "iframe",
            attrs: { src: "https://youtube.com/embed/xyz" },
          },
        ],
      },
    };

    const result = validateRichNewsDocument(docWithImage);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("image"))).toBe(true);
    expect(result.errors.some(e => e.includes("iframe"))).toBe(true);
  });

  it("7. Rejects malicious URL protocols (javascript:, data:, vbscript:)", () => {
    const docWithScriptLink: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Click here",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "javascript:alert(\"XSS\")" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(docWithScriptLink);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Unsafe link URL protocol"))).toBe(true);
  });

  it("8. Rejects oversized documents exceeding byte or text length limits", () => {
    const hugeText = "أ".repeat(1001);
    const hugeDoc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: hugeText }],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(hugeDoc, { maxTextLength: 1000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("exceeds maximum allowed limit"))).toBe(true);
  });

  it("9. Rejects excessive nesting depth exceeding 10 levels", () => {
    function createDeepNest(depth: number): any {
      if (depth === 0) {
        return {
          type: "paragraph",
          content: [{ type: "text", text: "Deep text" }],
        };
      }
      return {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [createDeepNest(depth - 1)],
          },
        ],
      };
    }

    const deepDoc = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [createDeepNest(12)],
      },
    };

    const result = validateRichNewsDocument(deepDoc, { maxNestingDepth: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Nesting depth"))).toBe(true);
  });

  it("10. Rejects unexpected or forbidden node attributes", () => {
    const docWithBadAttrs = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: {
              dir: "rtl",
              style: "color: red;",
              onclick: "alert(1)",
            },
            content: [{ type: "text", text: "اختبار" }],
          },
        ],
      },
    };

    const result = validateRichNewsDocument(docWithBadAttrs);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Unexpected attribute"))).toBe(true);
  });

  it("11. Verifies deterministic serialization and JSON string parsing", () => {
    const doc: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, dir: "rtl" },
            content: [{ type: "text", text: "عنوان تسلسلي" }],
          },
        ],
      },
    };

    const jsonString = serializeRichDocument(doc);
    expect(typeof jsonString).toBe("string");

    const parsed = parseRichDocument(jsonString);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.doc.content[0].type).toBe("heading");
  });
});
