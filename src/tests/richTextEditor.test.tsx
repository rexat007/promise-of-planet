import { describe, it, expect } from "vitest";
import { getE1CTiptapExtensions } from "../components/news/editor/tiptapExtensions";
import { 
  tiptapJsonToRichDocument, 
  richDocumentToTiptapJson 
} from "../services/richNewsTiptapAdapter";
import type { RichNewsDocumentWrapper } from "../types/richNewsDocument";
import { Editor } from "@tiptap/core";

describe("RichTextEditor Component Logic & Lifecycle (Headless)", () => {
  const validDoc: RichNewsDocumentWrapper = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "مرحبا بالعالم" }]
        }
      ]
    }
  };

  it("verifies extensions list matches E1-D requirements", () => {
    const extensions = getE1CTiptapExtensions();
    const names = extensions.map((e: any) => e.name);
    
    expect(names).toContain("starterKit");
    expect(names).toContain("underline");
    expect(names).toContain("link");
    expect(names).toContain("textAlign");
    expect(names).toContain("direction");
    
    // Verify specific starter-kit configuration
    const starterKit = extensions.find((e: any) => e.name === "starterKit") as any;
    expect(starterKit.options.heading.levels).toEqual([2, 3, 4]);
    expect(starterKit.options.codeBlock).toBe(false);
  });

  it("successfully round-trips documents through adapter and core engine", () => {
    const tiptapJson = richDocumentToTiptapJson(validDoc);
    const editor = new Editor({
      extensions: getE1CTiptapExtensions(),
      content: tiptapJson,
    });

    const outputJson = editor.getJSON() as any;
    const outputWrapper = tiptapJsonToRichDocument(outputJson);
    
    expect(outputWrapper.doc.content[0].type).toBe("paragraph");
    expect((outputWrapper.doc.content[0] as any).attrs.dir).toBe("rtl");
    
    editor.destroy();
  });

  it("demonstrates the object reference inequality risk in component update logic", () => {
    const editor = new Editor({
      extensions: getE1CTiptapExtensions(),
      content: richDocumentToTiptapJson(validDoc),
    });

    const json1 = editor.getJSON();
    const json2 = editor.getJSON();
    
    // DIFFERENT REFERENCES, SAME CONTENT
    expect(json1).not.toBe(json2); 
    expect(json1).toEqual(json2);
    
    // This confirms that reference comparison (!==) would trigger even for identical content
    expect(json1 !== json2).toBe(true);
    
    // This confirms stringification is a safe deep-equal for this specific use case
    expect(JSON.stringify(json1) === JSON.stringify(json2)).toBe(true);
    
    editor.destroy();
  });

  it("rejects unsafe links and invalid structures during conversion", () => {
    const unsafeJson = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "malicious",
          marks: [{ type: "link", attrs: { href: "javascript:evil()" } }]
        }]
      }]
    };

    expect(() => tiptapJsonToRichDocument(unsafeJson as any)).toThrow(/Unsafe link URL protocol/);
  });

  it("read-only state logic correctly configures the editor instance", () => {
    const editor = new Editor({
      extensions: getE1CTiptapExtensions(),
      content: richDocumentToTiptapJson(validDoc),
      editable: false,
    });

    expect(editor.isEditable).toBe(false);
    
    // Note: Calling editor.commands.insertContent() in headless mode 
    // without jsdom throws "there is no window object available".
    // We rely on isEditable configuration as the primary headless verification.
    
    editor.destroy();
  });

  it("verifies that external document replacement can be detected via stringification", () => {
    const docA = richDocumentToTiptapJson(validDoc);
    const docB = richDocumentToTiptapJson({
      ...validDoc,
      doc: { ...validDoc.doc, content: [] }
    });
    
    expect(JSON.stringify(docA) !== JSON.stringify(docB)).toBe(true);
    expect(JSON.stringify(docA) === JSON.stringify(richDocumentToTiptapJson(validDoc))).toBe(true);
  });
});
