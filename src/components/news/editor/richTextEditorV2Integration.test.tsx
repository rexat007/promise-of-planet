import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { getE1CTiptapExtensions } from "./tiptapExtensions";
import {
  RichTextEditor,
  RichTextEditorNodeViewScope,
  createRichTextEditorDocumentSession,
  createProductionRichTextEditorInstance,
  resolveEditorInstanceLocale,
  type RichTextEditorDocumentValue,
} from "./RichTextEditor";
import {
  EditorialImageNodeView,
  type EditorialImageLayoutV2,
  type EditorialImageWidthV2,
} from "./editorialImageExtension";
import {
  richDocumentToTiptapJsonByVersion,
  tiptapJsonToRichDocumentByVersion,
} from "../../../services/richNewsTiptapAdapter";
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../../../types/richNewsDocument";

function createSampleV1Doc(): RichNewsDocumentWrapper {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "تقرير بيئي من ولاية الخرطوم" }],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "تفاصيل المبادرة المجتمعية لحماية الغطاء النباتي على ضفاف النيل.",
            },
          ],
        },
      ],
    },
  };
}

function createSampleV2Doc(): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "فقرة افتتاحية قبل الصورة الميدانية." }],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset_2026_field_report_01",
            altAr: "صورة توثيقية لمشروع التشجير في الخرطوم",
            altEn: "Documentary photo of afforestation project in Khartoum",
            captionAr: "شتلات السنط على ضفاف النيل الأزرق",
            captionEn: "Acacia saplings along the Blue Nile",
            width: "50%",
            layout: "float-start",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [{ type: "text", text: "فقرة ختامية بعد الصورة الميدانية." }],
        },
      ],
    },
  };
}

function createSampleEnglishV2Doc(): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Opening paragraph in the English environmental report.",
            },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: "asset_2026_en_report_02",
            altAr: "وصف بديل للصورة بالعربية",
            altEn: "English alt description for the field image",
            captionAr: "تعليق عربي للصورة",
            captionEn: "Initial English caption",
            width: "75%",
            layout: "float-end",
          },
        },
      ],
    },
  };
}

function createNodeViewPropsFromHarness(
  harness: ReturnType<typeof createProductionRichTextEditorInstance>,
  occurrenceIndex = 0,
  selected = true
): any {
  const docJson = harness.getEditor().getJSON();
  const imageNode = (docJson.content || []).filter(
    (n: any) => n.type === "editorialImage"
  )[occurrenceIndex];
  const locale = harness.session.getLocale();

  return {
    node: {
      type: { name: "editorialImage" },
      attrs: imageNode?.attrs || {},
    },
    updateAttributes: (patch: Record<string, unknown>) => {
      harness.updateImageAttributesAt(occurrenceIndex, patch);
    },
    deleteNode: () => {
      harness.deleteImageNodeAt(occurrenceIndex);
    },
    selected,
    extension: {
      name: "editorialImage",
      options: {},
    },
    editor: {
      view: {
        dom: {
          getAttribute: (name: string) => {
            if (name === "dir") return locale.dir;
            if (name === "lang") return locale.lang;
            return null;
          },
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

describe("IMG-F3-09/D2-B — Production RichTextEditor V2 Image Rendering Integration", () => {
  // 1. Extension registration
  it("1. getE1CTiptapExtensions() includes editorialImage and preserves all existing E1-C extensions", () => {
    const extensions = getE1CTiptapExtensions();
    const names = extensions.map((ext: any) => ext.name);

    expect(names).toContain("starterKit");
    expect(names).toContain("underline");
    expect(names).toContain("link");
    expect(names).toContain("textAlign");
    expect(names).toContain("direction");
    expect(names).toContain("editorialImage");

    const starterKit = extensions.find((e: any) => e.name === "starterKit") as any;
    expect(starterKit.options.heading.levels).toEqual([2, 3, 4]);
    expect(starterKit.options.codeBlock).toBe(false);
    expect(starterKit.options.code).toBe(false);
    expect(starterKit.options.underline).toBe(false);
    expect(starterKit.options.link).toBe(false);

    const linkExt = extensions.find((e: any) => e.name === "link") as any;
    expect(linkExt.options.openOnClick).toBe(false);
    expect(linkExt.options.autolink).toBe(false);
    expect(linkExt.options.HTMLAttributes).toMatchObject({
      rel: "noopener noreferrer",
      target: "_blank",
    });

    const textAlignExt = extensions.find((e: any) => e.name === "textAlign") as any;
    expect(textAlignExt.options.types).toEqual(["heading", "paragraph"]);
    expect(textAlignExt.options.alignments).toEqual([
      "right",
      "left",
      "center",
      "justify",
    ]);
  });

  // 2. V1 round-trip
  it("2. V1 document loads and round-trips through RichTextEditor / Tiptap extension setup as schemaVersion: 1", () => {
    const v1Doc = createSampleV1Doc();
    const emitted: RichTextEditorDocumentValue[] = [];

    const harness = createProductionRichTextEditorInstance({
      initialValue: v1Doc,
      onChange: (val) => {
        emitted.push(val);
      },
    });

    expect(harness.session.getMinimumSchemaVersion()).toBe(1);
    expect(harness.session.getLocale()).toEqual({ lang: "ar", dir: "rtl" });

    const roundTripped = harness.getDocumentWrapper();
    expect(roundTripped.schemaVersion).toBe(1);
    expect(roundTripped).toEqual(v1Doc);

    // Trigger an editor update on the V1 text-only document
    const editedTiptapJson = harness.getEditor().getJSON() as any;
    editedTiptapJson.content[1].content[0].text =
      "تفاصيل المبادرة المجتمعية بعد التعديل التحريري.";
    const updateResult = harness.session.handleEditorUpdate(editedTiptapJson);

    expect(updateResult.ok).toBe(true);
    expect(updateResult.wrapper?.schemaVersion).toBe(1);
    const latestEmitted = emitted[emitted.length - 1];
    expect(latestEmitted).toBeDefined();
    expect(latestEmitted.schemaVersion).toBe(1);
    expect((latestEmitted.doc.content[1] as any).content[0].text).toBe(
      "تفاصيل المبادرة المجتمعية بعد التعديل التحريري."
    );

    harness.destroy();
  });

  // 3. Valid V2 round-trip
  it("3. Valid V2 document with editorialImage loads and round-trips as schemaVersion: 2", () => {
    const v2Doc = createSampleV2Doc();
    const emitted: RichTextEditorDocumentValue[] = [];

    const harness = createProductionRichTextEditorInstance({
      initialValue: v2Doc,
      onChange: (val) => {
        emitted.push(val);
      },
    });

    expect(harness.session.getMinimumSchemaVersion()).toBe(2);

    const roundTripped = harness.getDocumentWrapper();
    expect(roundTripped.schemaVersion).toBe(2);
    expect(roundTripped).toEqual(v2Doc);

    // Edit surrounding paragraph text and verify V2 + editorialImage survive intact
    const currentJson = harness.getEditor().getJSON() as any;
    currentJson.content[0].content[0].text = "فقرة افتتاحية محدثة.";
    const updateResult = harness.session.handleEditorUpdate(currentJson);

    expect(updateResult.ok).toBe(true);
    const latestEmitted = emitted[emitted.length - 1];
    expect(latestEmitted).toBeDefined();
    expect(latestEmitted.schemaVersion).toBe(2);
    expect(latestEmitted.doc.content[1]).toEqual(v2Doc.doc.content[1]);

    harness.destroy();
  });

  // 4. Canonical V2 attributes survival
  it("4. Existing V2 editorialImage attributes (assetId, altAr, altEn, captionAr, captionEn, width, layout) survive round-trip unchanged", () => {
    const widths: EditorialImageWidthV2[] = ["25%", "50%", "75%", "100%"];
    const layouts: EditorialImageLayoutV2[] = [
      "float-start",
      "float-end",
      "block-center",
      "block-full",
    ];

    for (const width of widths) {
      for (const layout of layouts) {
        const doc: RichNewsDocumentWrapperV2 = {
          schemaVersion: 2,
          doc: {
            type: "doc",
            content: [
              {
                type: "editorialImage",
                attrs: {
                  assetId: `asset_combo_${width.replace("%", "")}_${layout.replace("-", "_")}`,
                  altAr: "النص البديل بالعربية",
                  altEn: "English alt text",
                  captionAr: "التعليق التوضيحي بالعربية",
                  captionEn: "English caption text",
                  width,
                  layout,
                },
              },
            ],
          },
        };

        const editor = new Editor({
          extensions: getE1CTiptapExtensions(),
          content: richDocumentToTiptapJsonByVersion(doc),
        });

        const roundTripped = tiptapJsonToRichDocumentByVersion(
          editor.getJSON() as any,
          2
        ) as RichNewsDocumentWrapperV2;

        expect(roundTripped.schemaVersion).toBe(2);
        expect(roundTripped.doc.content[0]).toEqual(doc.doc.content[0]);
        const serializedAttrs = (roundTripped.doc.content[0] as any).attrs;
        expect(Object.keys(serializedAttrs).sort()).toEqual(
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
        expect(serializedAttrs.src).toBeUndefined();
        expect(serializedAttrs.publicUrl).toBeUndefined();
        expect(serializedAttrs.storagePath).toBeUndefined();
        expect(serializedAttrs.alignment).toBeUndefined();

        editor.destroy();
      }
    }
  });

  // 5. Width and layout action updates
  it("5. Width/layout action updates preserve schemaVersion: 2 and canonical attributes", () => {
    const v2Doc = createSampleV2Doc();
    const emitted: RichTextEditorDocumentValue[] = [];

    const harness = createProductionRichTextEditorInstance({
      initialValue: v2Doc,
      onChange: (val) => {
        emitted.push(val);
      },
    });

    // Change width to 75%
    harness.createImageNodeActions(0).handleSetWidth("75%");
    const step1 = emitted[emitted.length - 1];
    expect(step1.schemaVersion).toBe(2);
    expect((step1.doc.content[1] as any).attrs.width).toBe("75%");
    expect((step1.doc.content[1] as any).attrs.layout).toBe("float-start");

    // Change layout to float-end
    harness.createImageNodeActions(0).handleSetLayout("float-end");
    const step2 = emitted[emitted.length - 1];
    expect(step2.schemaVersion).toBe(2);
    expect((step2.doc.content[1] as any).attrs.layout).toBe("float-end");
    expect((step2.doc.content[1] as any).attrs.width).toBe("75%");

    // Change width to 100% -> upgrades layout to block-full
    harness.createImageNodeActions(0).handleSetWidth("100%");
    const step3 = emitted[emitted.length - 1];
    expect(step3.schemaVersion).toBe(2);
    expect((step3.doc.content[1] as any).attrs.width).toBe("100%");
    expect((step3.doc.content[1] as any).attrs.layout).toBe("block-full");

    // Change layout from block-full (100%) to float-start -> resets width to 50%
    harness.createImageNodeActions(0).handleSetLayout("float-start");
    const step4 = emitted[emitted.length - 1];
    expect(step4.schemaVersion).toBe(2);
    expect((step4.doc.content[1] as any).attrs.layout).toBe("float-start");
    expect((step4.doc.content[1] as any).attrs.width).toBe("50%");

    // Verify all other canonical attributes remained intact
    expect((step4.doc.content[1] as any).attrs.assetId).toBe(
      "asset_2026_field_report_01"
    );
    expect((step4.doc.content[1] as any).attrs.altAr).toBe(
      "صورة توثيقية لمشروع التشجير في الخرطوم"
    );
    expect((step4.doc.content[1] as any).attrs.altEn).toBe(
      "Documentary photo of afforestation project in Khartoum"
    );

    harness.destroy();
  });

  // 6. Caption edits in Arabic RTL vs English LTR editor instances
  it("6. Caption edits update captionAr in Arabic RTL mode and captionEn in English LTR mode based on editor instance", () => {
    const arDoc = createSampleV2Doc();
    const enDoc = createSampleEnglishV2Doc();

    let latestArDoc: RichTextEditorDocumentValue = arDoc;
    let latestEnDoc: RichTextEditorDocumentValue = enDoc;

    const arHarness = createProductionRichTextEditorInstance({
      initialValue: arDoc,
      onChange: (val) => {
        latestArDoc = val;
      },
    });

    const enHarness = createProductionRichTextEditorInstance({
      initialValue: enDoc,
      onChange: (val) => {
        latestEnDoc = val;
      },
    });

    // Verify locale resolution per editor instance (ar/rtl vs en/ltr)
    expect(arHarness.session.getLocale()).toEqual({ lang: "ar", dir: "rtl" });
    expect(enHarness.session.getLocale()).toEqual({ lang: "en", dir: "ltr" });

    // Edit caption in Arabic RTL editor -> updates captionAr only
    arHarness
      .createImageNodeActions(0)
      .handleCaptionChange("تعليق عربي محدث للصورة الميدانية");
    const arImgAttrs = (latestArDoc.doc.content[1] as any).attrs;
    expect(arImgAttrs.captionAr).toBe("تعليق عربي محدث للصورة الميدانية");
    expect(arImgAttrs.captionEn).toBe("Acacia saplings along the Blue Nile");

    // Edit caption in English LTR editor -> updates captionEn only
    enHarness
      .createImageNodeActions(0)
      .handleCaptionChange("Updated English field caption");
    const enImgAttrs = (latestEnDoc.doc.content[1] as any).attrs;
    expect(enImgAttrs.captionEn).toBe("Updated English field caption");
    expect(enImgAttrs.captionAr).toBe("تعليق عربي للصورة");

    // Verify NodeView rendering inside RichTextEditorNodeViewScope for both instances
    const arHtml = renderToStaticMarkup(
      <RichTextEditorNodeViewScope locale={arHarness.session.getLocale()}>
        <EditorialImageNodeView {...createNodeViewPropsFromHarness(arHarness, 0, true)} />
      </RichTextEditorNodeViewScope>
    );
    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain("تعليق عربي محدث للصورة الميدانية");

    const enHtml = renderToStaticMarkup(
      <RichTextEditorNodeViewScope locale={enHarness.session.getLocale()}>
        <EditorialImageNodeView {...createNodeViewPropsFromHarness(enHarness, 0, true)} />
      </RichTextEditorNodeViewScope>
    );
    expect(enHtml).toContain('dir="ltr"');
    expect(enHtml).toContain('lang="en"');
    expect(enHtml).toContain("Updated English field caption");

    arHarness.destroy();
    enHarness.destroy();
  });

  // 7. Deleting the only image in a V2 document preserves schemaVersion: 2
  it("7. Deleting the only image in a V2 document preserves schemaVersion: 2 for that editing session", () => {
    const v2Doc = createSampleV2Doc();
    const emitted: RichTextEditorDocumentValue[] = [];

    const harness = createProductionRichTextEditorInstance({
      initialValue: v2Doc,
      onChange: (val) => {
        emitted.push(val);
      },
    });

    // Delete the only editorialImage node via the NodeView delete action
    harness.createImageNodeActions(0).handleDeleteNode();

    const afterDelete = emitted.at(-1);
    expect(afterDelete).toBeDefined();
    expect(afterDelete?.schemaVersion).toBe(2);
    expect(
      afterDelete?.doc.content.some((block: any) => block.type === "editorialImage")
    ).toBe(false);

    // Subsequent text edits in the same V2 editing session must ALSO preserve schemaVersion: 2
    const nextJson = harness.getEditor().getJSON() as any;
    nextJson.content[0].content[0].text = "تعديل نصي لاحق بعد حذف الصورة.";
    const subsequentResult = harness.session.handleEditorUpdate(nextJson);

    expect(subsequentResult.ok).toBe(true);
    expect(subsequentResult.wrapper?.schemaVersion).toBe(2);
    expect(emitted.at(-1)?.schemaVersion).toBe(2);

    harness.destroy();
  });

  // 8. Missing preview URL renders private-asset placeholder rather than broken <img src="">
  it("8. Missing preview URL renders the private-asset placeholder rather than broken <img src=\"\">, while runtime preview URL renders safely without persisting to JSON", () => {
    const v2Doc = createSampleV2Doc();
    const harness = createProductionRichTextEditorInstance({
      initialValue: v2Doc,
      onChange: vi.fn(),
    });

    // Render without any preview URL registered for asset_2026_field_report_01
    const placeholderMarkup = renderToStaticMarkup(
      <RichTextEditorNodeViewScope
        locale={harness.session.getLocale()}
        previewUrlsByAssetId={{}}
      >
        <EditorialImageNodeView
          {...createNodeViewPropsFromHarness(harness, 0, false)}
        />
      </RichTextEditorNodeViewScope>
    );

    expect(placeholderMarkup).toContain(
      'data-testid="editorial-image-private-placeholder"'
    );
    expect(placeholderMarkup).toContain("asset_2026_field_report_01");
    expect(placeholderMarkup).not.toContain("<img");
    expect(placeholderMarkup).not.toContain('src=""');

    // Render WITH a runtime preview URL registered by assetId
    const runtimeBlobUrl = "blob:https://promise-of-planet.org/runtime-preview-123";
    const previewMarkup = renderToStaticMarkup(
      <RichTextEditorNodeViewScope
        locale={harness.session.getLocale()}
        previewUrlsByAssetId={{
          asset_2026_field_report_01: runtimeBlobUrl,
        }}
      >
        <EditorialImageNodeView
          {...createNodeViewPropsFromHarness(harness, 0, false)}
        />
      </RichTextEditorNodeViewScope>
    );

    expect(previewMarkup).toContain(
      'data-testid="editorial-image-preview-img"'
    );
    expect(previewMarkup).toContain(`src="${runtimeBlobUrl}"`);
    expect(previewMarkup).not.toContain(
      'data-testid="editorial-image-private-placeholder"'
    );

    // Verify the runtime preview URL is NEVER persisted into the canonical document JSON
    const persistedWrapper = harness.getDocumentWrapper();
    const serializedJsonString = JSON.stringify(persistedWrapper);
    expect(serializedJsonString).not.toContain(runtimeBlobUrl);
    expect(serializedJsonString).not.toContain("blob:");

    harness.destroy();
  });

  // 9. Malformed V2 image attributes fail closed
  it("9. Malformed V2 image attributes (src, publicUrl, storagePath, alignment, invalid width, invalid layout, empty altAr) fail closed without overwriting editor content", () => {
    const validBase = createSampleV2Doc();
    const invalidAttrPayloads: Array<{ label: string; attrs: Record<string, unknown> }> = [
      {
        label: "forbidden src attribute",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "50%",
          layout: "float-start",
          src: "https://example.com/leak.jpg",
        },
      },
      {
        label: "forbidden publicUrl attribute",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "50%",
          layout: "float-start",
          publicUrl: "https://storage.googleapis.com/bucket/img.jpg",
        },
      },
      {
        label: "forbidden storagePath attribute",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "50%",
          layout: "float-start",
          storagePath: "gs://private-bucket/news/img.jpg",
        },
      },
      {
        label: "legacy alignment attribute",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "50%",
          layout: "float-start",
          alignment: "right",
        },
      },
      {
        label: "invalid width value",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "60%",
          layout: "float-start",
        },
      },
      {
        label: "invalid layout value",
        attrs: {
          assetId: "asset_01",
          altAr: "وصف",
          width: "50%",
          layout: "inline-left",
        },
      },
      {
        label: "empty altAr value",
        attrs: {
          assetId: "asset_01",
          altAr: "   ",
          width: "50%",
          layout: "float-start",
        },
      },
    ];

    const onChangeSpy = vi.fn();
    const harness = createProductionRichTextEditorInstance({
      initialValue: validBase,
      onChange: onChangeSpy,
    });
    const initialEditorJson = harness.getEditor().getJSON();

    for (const testCase of invalidAttrPayloads) {
      const malformedDoc: any = {
        schemaVersion: 2,
        doc: {
          type: "doc",
          content: [
            {
              type: "editorialImage",
              attrs: testCase.attrs,
            },
          ],
        },
      };

      // 9a. Initial load fails closed
      expect(
        () =>
          createProductionRichTextEditorInstance({
            initialValue: malformedDoc,
            onChange: vi.fn(),
          }),
        `Expected initial load to fail closed for: ${testCase.label}`
      ).toThrow(/TIPTAP_ADAPTER_ERROR/);

      // 9b. External sync fails closed and preserves existing editor content
      const syncResult = harness.session.syncExternalValue(
        malformedDoc,
        harness.getEditor() as any
      );
      expect(syncResult.ok).toBe(false);
      expect(syncResult.synced).toBe(false);
      expect(harness.getEditor().getJSON()).toEqual(initialEditorJson);

      // 9c. Editor update fails closed without calling onChange or overwriting content
      const updateResult = harness.session.handleEditorUpdate(malformedDoc.doc);
      expect(updateResult.ok).toBe(false);
      expect(onChangeSpy).not.toHaveBeenCalled();
      expect(harness.getEditor().getJSON()).toEqual(initialEditorJson);
    }

    harness.destroy();
  });

  // 10. Nested editorialImage inside paragraph/blockquote/list fails closed
  it("10. Nested editorialImage inside paragraph, blockquote, or list fails closed", () => {
    const validImageNode = {
      type: "editorialImage",
      attrs: {
        assetId: "asset_nested_01",
        altAr: "صورة",
        width: "50%",
        layout: "float-start",
      },
    };

    const nestedInParagraph: any = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [validImageNode],
          },
        ],
      },
    };

    const nestedInBlockquote: any = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [validImageNode],
          },
        ],
      },
    };

    const nestedInBulletList: any = {
      schemaVersion: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [validImageNode],
              },
            ],
          },
        ],
      },
    };

    for (const nestedDoc of [
      nestedInParagraph,
      nestedInBlockquote,
      nestedInBulletList,
    ]) {
      expect(() =>
        createRichTextEditorDocumentSession({
          initialValue: nestedDoc,
          onChange: vi.fn(),
        })
      ).toThrow(/editorialImage must be a top-level block node/);
    }
  });

  // 11. Unknown schemaVersion fails closed
  it("11. Unknown or missing schemaVersion fails closed without converting to V1 or empty content", () => {
    const validBase = createSampleV2Doc();
    const onChangeSpy = vi.fn();
    const harness = createProductionRichTextEditorInstance({
      initialValue: validBase,
      onChange: onChangeSpy,
    });
    const preservedJson = harness.getEditor().getJSON();

    const unknownVersions: any[] = [
      { schemaVersion: 3, doc: validBase.doc },
      { schemaVersion: 0, doc: validBase.doc },
      { schemaVersion: "2", doc: validBase.doc },
      { doc: validBase.doc },
    ];

    for (const invalidWrapper of unknownVersions) {
      expect(() =>
        createRichTextEditorDocumentSession({
          initialValue: invalidWrapper,
          onChange: vi.fn(),
        })
      ).toThrow(/Unsupported or missing RichNewsDocument schemaVersion/);

      const syncResult = harness.session.syncExternalValue(
        invalidWrapper,
        harness.getEditor() as any
      );
      expect(syncResult.ok).toBe(false);
      expect(syncResult.synced).toBe(false);
      expect(harness.getEditor().getJSON()).toEqual(preservedJson);
      expect(onChangeSpy).not.toHaveBeenCalled();
    }

    harness.destroy();
  });

  // 12. readOnly mode disables editing as before
  it("12. readOnly mode disables editing on the production editor and prevents image attribute or deletion mutations", () => {
    const v2Doc = createSampleV2Doc();
    const onChangeSpy = vi.fn();

    const harness = createProductionRichTextEditorInstance({
      initialValue: v2Doc,
      onChange: onChangeSpy,
      readOnly: true,
    });

    expect(harness.getEditor().isEditable).toBe(false);

    // Attempt width change and deletion while in readOnly mode
    harness.createImageNodeActions(0).handleSetWidth("100%");
    harness.createImageNodeActions(0).handleDeleteNode();

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(harness.getDocumentWrapper()).toEqual(v2Doc);

    // Verify RichTextEditor component accepts V2 document in readOnly mode without throwing
    expect(() =>
      renderToStaticMarkup(
        <RichTextEditor
          value={v2Doc}
          onChange={onChangeSpy}
          readOnly={true}
        />
      )
    ).not.toThrow();

    expect(resolveEditorInstanceLocale(v2Doc)).toEqual({
      lang: "ar",
      dir: "rtl",
    });

    harness.destroy();
  });
});
