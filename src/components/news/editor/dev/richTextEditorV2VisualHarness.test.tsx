import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  RichTextEditorV2VisualHarness,
  createDevArabicV2Fixture,
  createDevEnglishV2Fixture,
  createDevOwnedPreviewBlobUrl,
  buildDevHarnessPreviewUrlsMap,
  DEV_PREVIEW_ASSET_ID,
  DEV_PRIVATE_PLACEHOLDER_ASSET_ID,
} from "./RichTextEditorV2VisualHarness";
import {
  RichTextEditorNodeViewScope,
  createProductionRichTextEditorInstance,
  type RichTextEditorDocumentValue,
} from "../RichTextEditor";
import { EditorialImageNodeView } from "../editorialImageExtension";
import {
  validateRichNewsDocumentByVersion,
  validateRichNewsDocumentV2,
} from "../../../../services/richNewsDocumentContract";

function computeBlobSha1(relPath: string): string {
  const buf = fs.readFileSync(path.resolve(process.cwd(), relPath));
  return crypto
    .createHash("sha1")
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest("hex");
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IMG-F3-09/D2-C — RichTextEditorV2VisualHarness", () => {
  it("1. provides valid canonical V2 Arabic and English fixtures with paragraphs before, beside (long wrapping paragraph), and after images and zero URL leakage", () => {
    const arFixture = createDevArabicV2Fixture();
    const enFixture = createDevEnglishV2Fixture();

    expect(arFixture.schemaVersion).toBe(2);
    expect(enFixture.schemaVersion).toBe(2);

    const arValidation = validateRichNewsDocumentByVersion(arFixture);
    const enValidation = validateRichNewsDocumentByVersion(enFixture);
    expect(arValidation.valid).toBe(true);
    expect(enValidation.valid).toBe(true);
    expect(validateRichNewsDocumentV2(arFixture).valid).toBe(true);
    expect(validateRichNewsDocumentV2(enFixture).valid).toBe(true);

    for (const fixture of [arFixture, enFixture]) {
      const content = fixture.doc.content ?? [];
      const firstImageIndex = content.findIndex(
        (node: any) =>
          node.type === "editorialImage" &&
          node.attrs?.assetId === DEV_PREVIEW_ASSET_ID
      );
      const secondImageIndex = content.findIndex(
        (node: any) =>
          node.type === "editorialImage" &&
          node.attrs?.assetId === DEV_PRIVATE_PLACEHOLDER_ASSET_ID
      );

      expect(firstImageIndex).toBeGreaterThan(0);
      expect(secondImageIndex).toBeGreaterThan(firstImageIndex);

      // Paragraph before first image
      expect(content[firstImageIndex - 1]?.type).toBe("paragraph");

      // Long wrapping paragraph immediately beside/after first floated image
      const wrappingParagraph = content[firstImageIndex + 1] as any;
      expect(wrappingParagraph?.type).toBe("paragraph");
      const wrappingText: string = wrappingParagraph?.content?.[0]?.text ?? "";
      expect(wrappingText.length).toBeGreaterThan(220);

      // Concluding paragraph after second image
      expect(content[content.length - 1]?.type).toBe("paragraph");

      // Zero URL/blob/src fields in canonical V2 JSON
      const serialized = JSON.stringify(fixture);
      expect(serialized).not.toContain("blob:");
      expect(serialized).not.toContain("data:image");
      expect(serialized).not.toContain("http://");
      expect(serialized).not.toContain("https://");
      expect(serialized).not.toContain('"previewUrl"');
      expect(serialized).not.toContain('"src"');
    }
  });

  it("2. creates and revokes an owned Blob object URL cleanly on lifecycle cleanup", () => {
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:dev-owned-v2-fixture-url");
    const revokeObjectUrlSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    const owned = createDevOwnedPreviewBlobUrl();
    expect(owned.url).toBe("blob:dev-owned-v2-fixture-url");
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    owned.revoke();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:dev-owned-v2-fixture-url");
  });

  it("3. loads Arabic and English DEV fixtures into the real production RichTextEditor instance with runtime preview mapping for the primary image and private-asset placeholder for the secondary image", () => {
    const emittedAr: RichTextEditorDocumentValue[] = [];
    const previewMap = buildDevHarnessPreviewUrlsMap(
      true,
      "blob:dev-harness-preview-01"
    );

    const arHarness = createProductionRichTextEditorInstance({
      initialValue: createDevArabicV2Fixture(),
      onChange: (val) => emittedAr.push(val),
      lang: "ar",
      dir: "rtl",
      previewUrlsByAssetId: previewMap,
    });

    expect(arHarness.session.getMinimumSchemaVersion()).toBe(2);
    expect(arHarness.session.getLocale()).toEqual({ lang: "ar", dir: "rtl" });

    // Primary image (index 0) resolves preview URL via runtime preview map
    const firstImageHtml = renderToStaticMarkup(
      <RichTextEditorNodeViewScope
        locale={{ lang: "ar", dir: "rtl" }}
        previewUrlsByAssetId={previewMap}
      >
        <EditorialImageNodeView
          {...createNodeViewPropsFromHarness(arHarness, 0, true)}
        />
      </RichTextEditorNodeViewScope>
    );
    expect(firstImageHtml).toContain('data-testid="editorial-image-preview-img"');
    expect(firstImageHtml).toContain('src="blob:dev-harness-preview-01"');
    expect(firstImageHtml).toContain('data-testid="editorial-image-toolbar"');
    expect(firstImageHtml).toContain('data-layout="float-start"');
    expect(firstImageHtml).toContain('data-width="50%"');

    // Secondary image (index 1) has no preview URL -> renders private-asset placeholder
    const secondImageHtml = renderToStaticMarkup(
      <RichTextEditorNodeViewScope
        locale={{ lang: "ar", dir: "rtl" }}
        previewUrlsByAssetId={previewMap}
      >
        <EditorialImageNodeView
          {...createNodeViewPropsFromHarness(arHarness, 1, false)}
        />
      </RichTextEditorNodeViewScope>
    );
    expect(secondImageHtml).toContain(
      'data-testid="editorial-image-private-placeholder"'
    );
    expect(secondImageHtml).toContain(DEV_PRIVATE_PLACEHOLDER_ASSET_ID);
    expect(secondImageHtml).not.toContain('data-testid="editorial-image-preview-img"');

    // Toggling preview map off causes primary image to render private-asset placeholder too
    const disabledPreviewMap = buildDevHarnessPreviewUrlsMap(
      false,
      "blob:dev-harness-preview-01"
    );
    const firstImagePlaceholderHtml = renderToStaticMarkup(
      <RichTextEditorNodeViewScope
        locale={{ lang: "ar", dir: "rtl" }}
        previewUrlsByAssetId={disabledPreviewMap}
      >
        <EditorialImageNodeView
          {...createNodeViewPropsFromHarness(arHarness, 0, true)}
        />
      </RichTextEditorNodeViewScope>
    );
    expect(firstImagePlaceholderHtml).toContain(
      'data-testid="editorial-image-private-placeholder"'
    );
    expect(firstImagePlaceholderHtml).not.toContain(
      'data-testid="editorial-image-preview-img"'
    );

    // Updating image width/layout inside the production editor preserves schemaVersion: 2 and zero URL leakage
    arHarness.updateImageAttributesAt(0, { width: "75%", layout: "float-end" });
    const latestAr = emittedAr[emittedAr.length - 1];
    expect(latestAr.schemaVersion).toBe(2);
    expect(JSON.stringify(latestAr)).not.toContain("blob:dev-harness-preview-01");

    arHarness.destroy();
  });

  it("4. renders RichTextEditorV2VisualHarness owner controls, RTL/LTR states, constrained-container mode with honest responsive note, and JSON inspector without forbidden controls", () => {
    const arHtml = renderToStaticMarkup(
      <RichTextEditorV2VisualHarness
        initialLang="ar"
        initialPrimaryPreviewEnabled={true}
        initialContainerMode="desktop"
        initialShowCanonicalJson={true}
      />
    );

    expect(arHtml).toContain('data-testid="rich-text-editor-v2-visual-harness"');
    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('data-testid="harness-lang-ar"');
    expect(arHtml).toContain('data-testid="harness-lang-en"');
    expect(arHtml).toContain('data-testid="harness-toggle-preview"');
    expect(arHtml).toContain('data-testid="harness-width-desktop"');
    expect(arHtml).toContain('data-testid="harness-width-mobile"');
    expect(arHtml).toContain('data-testid="harness-reset-fixture"');
    expect(arHtml).toContain('data-testid="harness-responsive-note"');
    expect(arHtml).toContain("@media (max-width: 639px)");
    expect(arHtml).toContain("max-w-4xl");
    expect(arHtml).toContain('data-testid="v2-visual-harness-json-panel"');
    expect(arHtml).toContain(DEV_PREVIEW_ASSET_ID);
    expect(arHtml).toContain(DEV_PRIVATE_PLACEHOLDER_ASSET_ID);

    // Constrained mobile container + English LTR state
    const enConstrainedHtml = renderToStaticMarkup(
      <RichTextEditorV2VisualHarness
        initialLang="en"
        initialPrimaryPreviewEnabled={false}
        initialContainerMode="constrained-mobile"
      />
    );
    expect(enConstrainedHtml).toContain('dir="ltr"');
    expect(enConstrainedHtml).toContain("max-w-[390px]");
    expect(enConstrainedHtml).toContain("Private Placeholder Mode (Unresolved)");
    expect(enConstrainedHtml).toContain("@media (max-width: 639px)");

    // Safety gates: no file upload input, no Insert Image button, no Save Draft/Save Changes button
    for (const html of [arHtml, enConstrainedHtml]) {
      expect(html).not.toContain('type="file"');
      expect(html).not.toMatch(/Insert Image|إدراج صورة/i);
      expect(html).not.toMatch(/Save Draft|Save Changes|حفظ المسودة/i);
    }
  });

  it("5. preserves DEV-only route isolation in App.tsx and keeps RichTextEditor, editorialImageExtension, tiptapExtensions, and Sandbox files untouched", () => {
    const appSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/App.tsx"),
      "utf8"
    );

    expect(appSource).toContain("window.location.hash === '#img-f1-sandbox'");
    expect(appSource).toContain("window.location.hash === '#img-f3-v2-visual'");
    expect(appSource).toContain("import.meta.env.DEV && hash === '#img-f1-sandbox'");
    expect(appSource).toContain("import.meta.env.DEV && hash === '#img-f3-v2-visual'");
    expect(appSource).toContain("import.meta.env.DEV && isImageSandboxOpen");
    expect(appSource).toContain("import.meta.env.DEV && isV2VisualHarnessOpen");
    expect(appSource).toContain(
      "import('./components/news/editor/dev/RichTextEditorV2VisualHarness')"
    );

    // Read-only boundary verification
    expect(computeBlobSha1("src/components/news/editor/RichTextEditor.tsx")).toBe(
      "4ad0783dda0c7a7735947c25ee3899567190c1eb"
    );
    expect(
      computeBlobSha1("src/components/news/editor/editorialImageExtension.tsx")
    ).toBe("63fe073a598ffc9d1197c94a2ce57ce9d84e5596");
    expect(
      computeBlobSha1("src/components/news/editor/tiptapExtensions.ts")
    ).toBe("e9a613019d6cf4862100257f02e894c5535971a4");
    expect(
      computeBlobSha1(
        "src/components/news/editor/sandbox/imageEditorSandboxExtensions.ts"
      )
    ).toBe("cbd2d0a1eae2a5cdf538d7d804b41f3b20a87bf6");
  });
});
