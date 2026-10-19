import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getE1CTiptapExtensions } from "../components/news/editor/tiptapExtensions";
import {
  tiptapJsonToRichDocument,
  richDocumentToTiptapJson,
  plainTextToTiptapJson,
  tiptapJsonToPlainText,
} from "../services/richNewsTiptapAdapter";
import type { TiptapDocJson } from "../services/richNewsTiptapAdapter";
import type { RichNewsDocumentWrapper, ParagraphNode, TextNode } from "../types/richNewsDocument";

describe("Tiptap Engine Adapter & Editor Instance Integration Tests (E1-D-R2, E1-D-R4 & E1-D-R5)", () => {
  it("1. Converts valid Tiptap v3 JSON with headings, paragraphs, and lists to E1-C wrapper", () => {
    const tiptapJson: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "استراتيجية التكيف المناخي" }],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [
            { type: "text", text: "المبادرة الوطنية لحماية حوض النيل ", marks: [{ type: "bold" }] },
            { type: "text", text: "بمشاركة منظمات دولية.", marks: [{ type: "italic" }] },
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
                  content: [{ type: "text", text: "المحور الأول: المياه" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const wrapper = tiptapJsonToRichDocument(tiptapJson);
    expect(wrapper.schemaVersion).toBe(1);
    expect(wrapper.doc.type).toBe("doc");
    expect(wrapper.doc.content).toHaveLength(3);

    const backToTiptap = richDocumentToTiptapJson(wrapper);
    expect(backToTiptap.type).toBe("doc");
    expect(backToTiptap.content).toHaveLength(3);
  });

  it("2. Instantiates a REAL Tiptap Editor instance with E1-C extensions and verifies content/attributes preservation", () => {
    const initialContent: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "عنوان رئيسي بالعربية" }],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [
            { type: "text", text: "نص مسطر ومربوط ", marks: [{ type: "underline" }] },
            {
              type: "text",
              text: "رابط موثوق",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.gov.sd", target: "_blank", rel: "noopener noreferrer" },
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [{ type: "text", text: "English paragraph with LTR direction." }],
        },
      ],
    };

    const editor = new Editor({
      extensions: getE1CTiptapExtensions(),
      content: initialContent,
    });

    const editorOutputJson = editor.getJSON() as TiptapDocJson;
    editor.destroy();

    expect(editorOutputJson.type).toBe("doc");
    expect(editorOutputJson.content).toBeDefined();

    const wrapper = tiptapJsonToRichDocument(editorOutputJson);
    expect(wrapper.schemaVersion).toBe(1);
    expect(wrapper.doc.content.length).toBeGreaterThanOrEqual(3);

    const para1 = wrapper.doc.content[0] as ParagraphNode;
    expect(para1.attrs?.dir).toBe("rtl");
    expect(para1.attrs?.textAlign).toBe("right");

    const para3 = wrapper.doc.content[2] as ParagraphNode;
    expect(para3.attrs?.dir).toBe("ltr");
    expect(para3.attrs?.textAlign).toBe("left");
  });

  it("3. Rejects Tiptap documents containing codeBlock or code marks before/after processing", () => {
    const invalidTiptapJson: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "console.log(\"unsupported\");" }],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(invalidTiptapJson)).toThrowError(
      /TIPTAP_ADAPTER_ERROR: Document contains disallowed elements/
    );
  });

  it("4. Rejects documents containing malicious URL protocols (javascript:, data:)", () => {
    const docWithScriptLink: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Unsafe link",
              marks: [
                {
                  type: "link",
                  attrs: { href: "javascript:alert(1)" },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(docWithScriptLink)).toThrowError(
      /Unsafe link URL protocol in mark/
    );
  });

  it("5. Converts legacy plain text to Tiptap JSON and preserves Arabic/English text", () => {
    const legacyText = "العنوان الرئيسي\n\nفقرة تفصيلية عن البيئة والمناخ في السودان.\n\nEnglish Summary Paragraph.";
    const tiptapJson = plainTextToTiptapJson(legacyText);
    expect(tiptapJson.type).toBe("doc");
    expect(tiptapJson.content).toHaveLength(3);

    const extracted = tiptapJsonToPlainText(tiptapJson);
    expect(extracted).toBe(legacyText);
  });

  it("6. Round-trips E1-C RichNewsDocumentWrapper through real Tiptap Editor instance losslessly", () => {
    const originalWrapper: RichNewsDocumentWrapper = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "نص اختباري عبر محرك تيب تاب" }],
          },
        ],
      },
    };

    const tiptapJson = richDocumentToTiptapJson(originalWrapper);
    const editor = new Editor({
      extensions: getE1CTiptapExtensions(),
      content: tiptapJson,
    });

    const editorJson = editor.getJSON() as TiptapDocJson;
    editor.destroy();

    const reWrapped = tiptapJsonToRichDocument(editorJson);
    expect(reWrapped.schemaVersion).toBe(1);

    const firstPara = reWrapped.doc.content[0] as ParagraphNode;
    const firstTextNode = firstPara.content?.[0] as TextNode;
    expect(firstTextNode.text).toBe("نص اختباري عبر محرك تيب تاب");
  });

  it("7. Normalizes Tiptap null dir/textAlign and null link class/title attributes without violating strict E1-C contract", () => {
    const tiptapJsonWithDefaults: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: null, textAlign: null },
          content: [
            {
              type: "text",
              text: "Normalized Link",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.org",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const wrapper = tiptapJsonToRichDocument(tiptapJsonWithDefaults);
    expect(wrapper.schemaVersion).toBe(1);
    const para = wrapper.doc.content[0] as ParagraphNode;
    expect(para.attrs?.dir).toBeUndefined();
    expect(para.attrs?.textAlign).toBeUndefined();

    const firstNode = para.content?.[0] as TextNode | undefined;
    const linkMark = firstNode?.marks?.[0];
    expect(linkMark?.type).toBe("link");
    if (linkMark?.type === "link") {
      expect(linkMark.attrs.href).toBe("https://example.org");
      expect((linkMark.attrs as any).class).toBeUndefined();
      expect((linkMark.attrs as any).title).toBeUndefined();
    }
  });

  it("8. Rejects non-null link class attribute", () => {
    const docWithLinkClass: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Custom link class",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.org", class: "custom-link-class" },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(docWithLinkClass)).toThrowError(
      /Unexpected attribute "class" in link mark/
    );
  });

  it("9. Rejects non-null link title attribute", () => {
    const docWithLinkTitle: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Custom link title",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.org", title: "Custom Title" },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(docWithLinkTitle)).toThrowError(
      /Unexpected attribute "title" in link mark/
    );
  });

  it("10. Rejects string 'null' direction or alignment", () => {
    const docWithStringNullDir: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "null" },
          content: [{ type: "text", text: "Invalid dir string" }],
        },
      ],
    };

    const docWithStringNullAlign: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "null" },
          content: [{ type: "text", text: "Invalid align string" }],
        },
      ],
    };

    expect(() => tiptapJsonToRichDocument(docWithStringNullDir)).toThrowError(
      /Invalid text direction "null" on node "paragraph"/
    );

    expect(() => tiptapJsonToRichDocument(docWithStringNullAlign)).toThrowError(
      /Invalid alignment "null" on node "paragraph"/
    );
  });

  it("11. Preserves input JSON immutability during normalization", () => {
    const originalInput: TiptapDocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: null, textAlign: null },
          content: [
            {
              type: "text",
              text: "Unchanged input",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.org", class: null, title: null },
                },
              ],
            },
          ],
        },
      ],
    };

    const inputSnapshot = JSON.parse(JSON.stringify(originalInput));
    tiptapJsonToRichDocument(originalInput);
    expect(originalInput).toEqual(inputSnapshot);
  });
});
