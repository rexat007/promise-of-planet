import { describe, it, expect } from "vitest";
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../types/richNewsDocument";
import {
  validateRichNewsDocument,
  validateRichNewsDocumentV2,
  validateRichNewsDocumentByVersion,
  extractPlainTextFromRichDocument,
  convertPlainTextToRichDocument,
  serializeRichDocument,
  parseRichDocument,
} from "./richNewsDocumentContract";
import {
  validateRichNewsDocument as serverValidateV1,
  validateRichNewsDocumentV2 as serverValidateV2,
  validateRichNewsDocumentByVersion as serverValidateByVersion,
  extractPlainTextFromRichDocument as serverExtractPlainText,
  convertPlainTextToRichDocument as serverConvertPlainText,
  serializeRichDocument as serverSerialize,
  parseRichDocument as serverParse,
} from "../../functions/src/shared/richNewsDocumentContract";

describe("IMG-F3-09/D1-B — Frontend Rich Document V1/V2 Contract Convergence", () => {
  const validV1DocAr: RichNewsDocumentWrapper = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "عنوان فرعي للتقرير" }],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [
            { type: "text", text: "الفقرة الأولى من المقال." },
            { type: "hardBreak" },
            { type: "text", text: "السطر الثاني داخل الفقرة." },
          ],
        },
        {
          type: "blockquote",
          attrs: { dir: "rtl" },
          content: [
            {
              type: "paragraph",
              attrs: { dir: "rtl" },
              content: [{ type: "text", text: "اقتباس بيئي مهم." }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { dir: "rtl" },
                  content: [{ type: "text", text: "عنصر قائمة أول" }],
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
                          attrs: { dir: "rtl" },
                          content: [{ type: "text", text: "عنصر متداخل ثانٍ" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "horizontalRule",
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [{ type: "text", text: "English concluding summary." }],
        },
      ],
    },
  };

  const validV2DocAr: RichNewsDocumentWrapperV2 = {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "مبادرة تشجير حوض النيل" }],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [
            { type: "text", text: "انطلقت المرحلة الأولى من مشروع التشجير." },
            { type: "hardBreak" },
            { type: "text", text: "بمشاركة مجتمعية واسعة." },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
            altAr: "صورة ميدانية لغرس أشجار السنط على ضفاف النيل",
            altEn: "Field photo of planting Acacia trees along the Nile bank",
            captionAr: "المتطوعون يغرسون الشتلات في ولاية نهر النيل",
            captionEn: "Volunteers planting saplings in River Nile State",
            width: "50%",
            layout: "float-start",
          },
        },
        {
          type: "blockquote",
          attrs: { dir: "rtl" },
          content: [
            {
              type: "paragraph",
              attrs: { dir: "rtl" },
              content: [{ type: "text", text: "اقتباس ميداني حول استدامة الغطاء النباتي." }],
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
                  attrs: { dir: "rtl" },
                  content: [{ type: "text", text: "المرحلة الأولى: نهر النيل" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [{ type: "text", text: "Phase one targets planting 10,000 native trees." }],
        },
      ],
    },
  };

  describe("1. Version-Dispatched Validator (validateRichNewsDocumentByVersion)", () => {
    it("accepts valid V1 documents via version dispatch while keeping V1 and V2 validators strict", () => {
      expect(validateRichNewsDocument(validV1DocAr)).toEqual({ valid: true, errors: [] });
      expect(validateRichNewsDocumentV2(validV1DocAr).valid).toBe(false);
      expect(validateRichNewsDocumentByVersion(validV1DocAr)).toEqual({ valid: true, errors: [] });
    });

    it("accepts valid V2 documents with editorialImage via version dispatch while V1 validator rejects them", () => {
      expect(validateRichNewsDocumentV2(validV2DocAr)).toEqual({ valid: true, errors: [] });
      expect(validateRichNewsDocument(validV2DocAr).valid).toBe(false);
      expect(validateRichNewsDocumentByVersion(validV2DocAr)).toEqual({ valid: true, errors: [] });
    });

    it("forwards custom validation limits to the underlying V1 or V2 validator", () => {
      const limitResultV1 = validateRichNewsDocumentByVersion(validV1DocAr, { maxTextLength: 5 });
      expect(limitResultV1.valid).toBe(false);
      expect(limitResultV1.errors.some((e) => e.includes("Total text length"))).toBe(true);

      const limitResultV2 = validateRichNewsDocumentByVersion(validV2DocAr, { maxTextLength: 5 });
      expect(limitResultV2.valid).toBe(false);
      expect(limitResultV2.errors.some((e) => e.includes("Total text length"))).toBe(true);
    });

    it("fails closed for non-object, null, array, missing, or unsupported schemaVersion values", () => {
      expect(validateRichNewsDocumentByVersion(null)).toEqual({
        valid: false,
        errors: ["Document wrapper must be a non-null object."],
      });
      expect(validateRichNewsDocumentByVersion(undefined)).toEqual({
        valid: false,
        errors: ["Document wrapper must be a non-null object."],
      });
      expect(validateRichNewsDocumentByVersion([])).toEqual({
        valid: false,
        errors: ["Document wrapper must be a non-null object."],
      });
      expect(validateRichNewsDocumentByVersion("string")).toEqual({
        valid: false,
        errors: ["Document wrapper must be a non-null object."],
      });

      for (const badVersion of [undefined, null, 0, 3, "1", "2", -1, NaN]) {
        const doc = { ...validV1DocAr, schemaVersion: badVersion };
        const res = validateRichNewsDocumentByVersion(doc);
        expect(res.valid).toBe(false);
        expect(res.errors).toEqual([
          `Unsupported or missing schemaVersion: expected 1 or 2, received ${String(badVersion)}.`,
        ]);
      }
    });

    it("rejects V1 documents containing V2 editorialImage nodes", () => {
      const v1WithImage = {
        schemaVersion: 1,
        doc: validV2DocAr.doc,
      };
      const res = validateRichNewsDocumentByVersion(v1WithImage);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Disallowed or unknown node type: "editorialImage"'))).toBe(true);
    });

    it("rejects V2 editorialImage nodes with invalid attributes, URLs, or children", () => {
      const invalidCases = [
        {
          label: "missing altAr",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
              altAr: "   ",
              width: "50%",
              layout: "float-start",
            },
          },
          expectedError: "editorialImage altAr must be a non-empty string",
        },
        {
          label: "invalid width",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
              altAr: "نص بديل",
              width: "60%",
              layout: "float-start",
            },
          },
          expectedError: "editorialImage width must be one of",
        },
        {
          label: "invalid layout",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-left",
            },
          },
          expectedError: "editorialImage layout must be one of",
        },
        {
          label: "forbidden src attribute",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-start",
              src: "https://storage.googleapis.com/bucket/img.webp",
            },
          },
          expectedError: 'Disallowed or unknown attribute "src"',
        },
        {
          label: "forbidden blob URL in assetId",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "blob:https://promiseofplanet.org/1234",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-start",
            },
          },
          expectedError: "editorialImage assetId must be a non-empty path-safe string",
        },
        {
          label: "editorialImage with children",
          node: {
            type: "editorialImage",
            attrs: {
              assetId: "asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
              altAr: "نص بديل",
              width: "50%",
              layout: "float-start",
            },
            content: [{ type: "text", text: "child text" }],
          },
          expectedError: "editorialImage node cannot have children content.",
        },
      ];

      for (const testCase of invalidCases) {
        const doc = {
          schemaVersion: 2,
          doc: {
            type: "doc",
            content: [testCase.node],
          },
        };
        const res = validateRichNewsDocumentByVersion(doc);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes(testCase.expectedError))).toBe(true);
      }
    });
  });

  describe("2. Plain-Text Extraction (extractPlainTextFromRichDocument)", () => {
    it("preserves V1 output unchanged for paragraphs, headings, nested lists, hardBreaks, horizontalRule, and Arabic/English text", () => {
      const extracted = extractPlainTextFromRichDocument(validV1DocAr);
      expect(extracted).toBe(
        [
          "عنوان فرعي للتقرير",
          "الفقرة الأولى من المقال.\nالسطر الثاني داخل الفقرة.",
          "اقتباس بيئي مهم.",
          "عنصر قائمة أولعنصر متداخل ثانٍ",
          "English concluding summary.",
        ].join("\n\n")
      );
    });

    it("extracts V2 text accurately while editorialImage nodes contribute no plain text and leak no metadata", () => {
      const extracted = extractPlainTextFromRichDocument(validV2DocAr);
      expect(extracted).toBe(
        [
          "مبادرة تشجير حوض النيل",
          "انطلقت المرحلة الأولى من مشروع التشجير.\nبمشاركة مجتمعية واسعة.",
          "اقتباس ميداني حول استدامة الغطاء النباتي.",
          "المرحلة الأولى: نهر النيل",
          "Phase one targets planting 10,000 native trees.",
        ].join("\n\n")
      );

      expect(extracted).not.toContain("asset_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c");
      expect(extracted).not.toContain("صورة ميدانية");
      expect(extracted).not.toContain("Field photo");
      expect(extracted).not.toContain("المتطوعون يغرسون");
      expect(extracted).not.toContain("Volunteers planting");
      expect(extracted).not.toContain("50%");
      expect(extracted).not.toContain("float-start");
    });

    it("returns empty string for a valid V2 document containing only editorialImage nodes", () => {
      const imageOnlyV2: RichNewsDocumentWrapperV2 = {
        schemaVersion: 2,
        doc: {
          type: "doc",
          content: [
            {
              type: "editorialImage",
              attrs: {
                assetId: "asset_11112222333344445555666677778888",
                altAr: "صورة مستقلة",
                width: "100%",
                layout: "block-full",
              },
            },
          ],
        },
      };
      expect(extractPlainTextFromRichDocument(imageOnlyV2)).toBe("");
    });

    it("returns empty string for unknown, missing, or invalid schemaVersion and invalid V1/V2 documents", () => {
      const unversionedWrapper = { doc: validV1DocAr.doc };
      const rawDocNode = validV1DocAr.doc;
      const versionZero = { ...validV1DocAr, schemaVersion: 0 };
      const versionThree = { ...validV2DocAr, schemaVersion: 3 };
      const v1WithImage = { schemaVersion: 1, doc: validV2DocAr.doc };
      const v2WithInvalidImage = {
        schemaVersion: 2,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "نص لا يجوز استخراجه عند فشل التحقق" }],
            },
            {
              type: "editorialImage",
              attrs: {
                assetId: "asset_11112222333344445555666677778888",
                altAr: "",
                width: "50%",
                layout: "float-start",
              },
            },
          ],
        },
      };

      expect(extractPlainTextFromRichDocument(null)).toBe("");
      expect(extractPlainTextFromRichDocument(undefined)).toBe("");
      expect(extractPlainTextFromRichDocument(unversionedWrapper)).toBe("");
      expect(extractPlainTextFromRichDocument(rawDocNode)).toBe("");
      expect(extractPlainTextFromRichDocument(versionZero)).toBe("");
      expect(extractPlainTextFromRichDocument(versionThree)).toBe("");
      expect(extractPlainTextFromRichDocument(v1WithImage)).toBe("");
      expect(extractPlainTextFromRichDocument(v2WithInvalidImage)).toBe("");
    });
  });

  describe("3. Exact Frontend / Server Contract Parity (D1-A <-> D1-B)", () => {
    it("produces identical validation and plain-text outputs across frontend and server modules for all fixtures", () => {
      const fixtures: unknown[] = [
        validV1DocAr,
        validV2DocAr,
        null,
        undefined,
        {},
        { doc: validV1DocAr.doc },
        validV1DocAr.doc,
        { ...validV1DocAr, schemaVersion: 2 },
        { ...validV2DocAr, schemaVersion: 1 },
        { ...validV2DocAr, schemaVersion: 3 },
        {
          schemaVersion: 2,
          doc: {
            type: "doc",
            content: [
              {
                type: "editorialImage",
                attrs: {
                  assetId: "asset_ok",
                  altAr: "نص بديل",
                  width: "50%",
                  layout: "float-start",
                  src: "https://example.com/disallow.jpg",
                },
              },
            ],
          },
        },
      ];

      for (const fixture of fixtures) {
        expect(validateRichNewsDocument(fixture)).toEqual(serverValidateV1(fixture));
        expect(validateRichNewsDocumentV2(fixture)).toEqual(serverValidateV2(fixture));
        expect(validateRichNewsDocumentByVersion(fixture)).toEqual(serverValidateByVersion(fixture));
        expect(extractPlainTextFromRichDocument(fixture)).toBe(serverExtractPlainText(fixture));
      }
    });

    it("preserves identical convertPlainTextToRichDocument, serializeRichDocument, and parseRichDocument behavior", () => {
      const sampleText = "فقرة عربية أولى\nسطر ثانٍ\n\nSecond paragraph in English";
      const frontConverted = convertPlainTextToRichDocument(sampleText);
      const serverConverted = serverConvertPlainText(sampleText);
      expect(frontConverted).toEqual(serverConverted);

      const frontSerialized = serializeRichDocument(frontConverted);
      const serverSerialized = serverSerialize(serverConverted);
      expect(frontSerialized).toBe(serverSerialized);

      expect(parseRichDocument(frontSerialized)).toEqual(serverParse(serverSerialized));
    });
  });
});
