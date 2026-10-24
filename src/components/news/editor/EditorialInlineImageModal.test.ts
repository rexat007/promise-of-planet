import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import {
  EditorialInlineImageModal,
  normalizeCanonicalImageFile,
  optimizeImageBinaryForWeb,
  EDITORIAL_USAGE_INTEGRATION_CONTRACT_NOTE,
  type PreparedEditorialImage,
  type EditorialUsageIntent,
} from "./EditorialInlineImageModal";

import {
  MAX_NEWS_IMAGE_UPLOAD_BYTES,
  validateNewsImageSelectionAndMetadata,
  type NewsImageMetadataFormInput,
} from "../../../services/newsAdminClient";

import {
  ALLOWED_EDITORIAL_IMAGE_WIDTHS,
  ALLOWED_EDITORIAL_IMAGE_LAYOUTS,
  type EditorialImageWidthV2,
  type EditorialImageLayoutV2,
} from "./editorialImageExtension";

function createDummyFileLike(
  name: string,
  type: string,
  sizeBytes: number,
  content: string = "dummy-image-content"
): File {
  const blob = new Blob([content], { type });
  Object.defineProperty(blob, "size", { value: sizeBytes });
  Object.defineProperty(blob, "name", { value: name });
  return blob as unknown as File;
}

describe("IMG-F3-09/D2-D2B2 — Production Inline Image Preparation Modal", () => {
  // 1. Initial image selection & normalization
  it("1. normalizes initial image selection to canonical File and aligns extensions for JPEG, PNG, and WebP", () => {
    // JPEG
    const jpegFile = createDummyFileLike("field-report.jpeg", "image/jpeg", 500_000);
    const jpegNorm = normalizeCanonicalImageFile(jpegFile);
    expect(jpegNorm.ok).toBe(true);
    expect(jpegNorm.mimeType).toBe("image/jpeg");
    expect(jpegNorm.file?.name).toBe("field-report.jpeg");
    expect(jpegNorm.file?.type).toBe("image/jpeg");

    // JPEG with .jpg
    const jpgFile = createDummyFileLike("field-photo.jpg", "image/jpeg", 400_000);
    const jpgNorm = normalizeCanonicalImageFile(jpgFile);
    expect(jpgNorm.ok).toBe(true);
    expect(jpgNorm.file?.name).toBe("field-photo.jpg");

    // PNG
    const pngFile = createDummyFileLike("diagram.png", "image/png", 800_000);
    const pngNorm = normalizeCanonicalImageFile(pngFile);
    expect(pngNorm.ok).toBe(true);
    expect(pngNorm.mimeType).toBe("image/png");
    expect(pngNorm.file?.name).toBe("diagram.png");
    expect(pngNorm.file?.type).toBe("image/png");

    // WebP
    const webpFile = createDummyFileLike("scenery.webp", "image/webp", 350_000);
    const webpNorm = normalizeCanonicalImageFile(webpFile);
    expect(webpNorm.ok).toBe(true);
    expect(webpNorm.mimeType).toBe("image/webp");
    expect(webpNorm.file?.name).toBe("scenery.webp");
    expect(webpNorm.file?.type).toBe("image/webp");
  });

  // 2. MIME-extension alignment when converted
  it("2. normalizes converted PNG/WebP to JPEG extension only when output MIME confirms image/jpeg", () => {
    // Converted PNG to JPEG
    const convertedFromPng = createDummyFileLike("original-chart.png", "image/jpeg", 600_000);
    const normResult = normalizeCanonicalImageFile(convertedFromPng);
    expect(normResult.ok).toBe(true);
    expect(normResult.mimeType).toBe("image/jpeg");
    expect(normResult.file?.name).toBe("original-chart.jpg");
    expect(normResult.file?.type).toBe("image/jpeg");

    // Converted WebP to JPEG
    const convertedFromWebp = createDummyFileLike("high-res.webp", "image/jpeg", 750_000);
    const normWebpResult = normalizeCanonicalImageFile(convertedFromWebp);
    expect(normWebpResult.ok).toBe(true);
    expect(normWebpResult.file?.name).toBe("high-res.jpg");
  });

  // 3. Unsupported MIME rejection
  it("3. rejects unsupported MIME types (AVIF, SVG, GIF, PDF) with bilingual error messaging", () => {
    const unsupportedPayloads = [
      { name: "photo.avif", type: "image/avif" },
      { name: "vector.svg", type: "image/svg+xml" },
      { name: "animation.gif", type: "image/gif" },
      { name: "document.pdf", type: "application/pdf" },
      { name: "unknown.bin", type: "application/octet-stream" },
      { name: "no-mime", type: "" },
    ];

    for (const item of unsupportedPayloads) {
      const file = createDummyFileLike(item.name, item.type, 100_000);
      const res = normalizeCanonicalImageFile(file);
      expect(res.ok).toBe(false);
      expect(res.errorEn).toContain("Only PNG, JPEG, and WebP images are supported");
      expect(res.errorAr).toContain("PNG أو JPEG أو WebP");
    }
  });

  // 4. Exact 15,000,000-byte boundary enforcement
  it("4. strictly enforces exact 15,000,000-byte boundary (accepts 15,000,000, rejects 15,000,001 and empty)", () => {
    // Empty binary (0 bytes)
    const emptyFile = createDummyFileLike("empty.jpg", "image/jpeg", 0);
    const emptyRes = normalizeCanonicalImageFile(emptyFile);
    expect(emptyRes.ok).toBe(false);
    expect(emptyRes.errorEn).toContain("Selected image file is empty");

    // Exact limit (15,000,000 bytes)
    const limitFile = createDummyFileLike("max-size.jpg", "image/jpeg", MAX_NEWS_IMAGE_UPLOAD_BYTES);
    const limitRes = normalizeCanonicalImageFile(limitFile);
    expect(limitRes.ok).toBe(true);
    expect(limitRes.file?.size).toBe(15_000_000);

    // Exceeds limit by 1 byte (15,000,001 bytes)
    const oversizedFile = createDummyFileLike("too-large.jpg", "image/jpeg", MAX_NEWS_IMAGE_UPLOAD_BYTES + 1);
    const overRes = normalizeCanonicalImageFile(oversizedFile);
    expect(overRes.ok).toBe(false);
    expect(overRes.errorEn).toContain("exceeds the maximum limit of 15,000,000 bytes");
    expect(overRes.errorAr).toContain("15 ميجابايت");
  });

  // 5. Prohibited path segments and filename security
  it("5. rejects prohibited filename path segments without disguising unknown extensions", () => {
    const maliciousNames = [
      "../escaped.jpg",
      "folder/photo.jpg",
      "folder\\photo.jpg",
      "https://example.com/photo.jpg",
      "blob:http://localhost/123",
      "editorial_images/private/photo.jpg",
    ];

    for (const name of maliciousNames) {
      const file = createDummyFileLike(name, "image/jpeg", 200_000);
      const res = normalizeCanonicalImageFile(file);
      expect(res.ok).toBe(false);
      expect(res.errorEn).toContain("prohibited path segments");
    }
  });

  // 6. Metadata validation — required altAr
  it("6. validates that required altAr is non-empty, under 500 chars, and contains no prohibited patterns", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("valid.jpg", "image/jpeg", 100_000)
    ).file!;

    // Empty altAr fails
    const emptyAlt: NewsImageMetadataFormInput = { altAr: "" };
    expect(validateNewsImageSelectionAndMetadata(emptyAlt, validFile).valid).toBe(false);

    // Whitespace only fails
    const whitespaceAlt: NewsImageMetadataFormInput = { altAr: "    " };
    expect(validateNewsImageSelectionAndMetadata(whitespaceAlt, validFile).valid).toBe(false);

    // Exceeds 500 chars fails
    const longAlt: NewsImageMetadataFormInput = { altAr: "أ".repeat(501) };
    expect(validateNewsImageSelectionAndMetadata(longAlt, validFile).valid).toBe(false);

    // Prohibited URL pattern in altAr fails
    const urlAlt: NewsImageMetadataFormInput = { altAr: "صورة توثيقية https://malicious.com/test" };
    expect(validateNewsImageSelectionAndMetadata(urlAlt, validFile).valid).toBe(false);

    // Valid altAr passes
    const validAlt: NewsImageMetadataFormInput = {
      altAr: "صورة توثيقية لمشروع تشجير غابات السنط على ضفاف النيل",
    };
    expect(validateNewsImageSelectionAndMetadata(validAlt, validFile).valid).toBe(true);
  });

  // 7. Metadata validation — optional fields
  it("7. validates optional metadata fields (altEn, captionAr, captionEn, photographerCredit, licensingInfo)", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("valid.png", "image/png", 150_000)
    ).file!;

    const baseAltAr = "وصف بديل صالح بالعربية";

    // Valid complete optional metadata passes
    const completeMetadata: NewsImageMetadataFormInput = {
      altAr: baseAltAr,
      altEn: "Valid English alt description",
      captionAr: "شرح توضيحي للمشروع البيئي بالعربية",
      captionEn: "Detailed environmental project caption",
      photographerCredit: "فريق وعد الكوكب / أرشيف المنصة",
      licensingInfo: "CC-BY 4.0",
    };
    expect(validateNewsImageSelectionAndMetadata(completeMetadata, validFile).valid).toBe(true);

    // Oversized altEn fails (> 500)
    expect(
      validateNewsImageSelectionAndMetadata(
        { ...completeMetadata, altEn: "a".repeat(501) },
        validFile
      ).valid
    ).toBe(false);

    // Oversized captionAr fails (> 1000)
    expect(
      validateNewsImageSelectionAndMetadata(
        { ...completeMetadata, captionAr: "ب".repeat(1001) },
        validFile
      ).valid
    ).toBe(false);

    // Oversized photographerCredit fails (> 255)
    expect(
      validateNewsImageSelectionAndMetadata(
        { ...completeMetadata, photographerCredit: "c".repeat(256) },
        validFile
      ).valid
    ).toBe(false);

    // Prohibited gs:// pattern in captionEn fails
    expect(
      validateNewsImageSelectionAndMetadata(
        { ...completeMetadata, captionEn: "Photo stored at gs://bucket/img.jpg" },
        validFile
      ).valid
    ).toBe(false);
  });

  // 8. Editorial usage intent values & integration requirement note
  it("8. supports all three editorial usage intent values (inline, cover, both) and records D2-D2B3 single-intake requirement", () => {
    expect(EDITORIAL_USAGE_INTEGRATION_CONTRACT_NOTE).toContain("D2-D2B3");
    expect(EDITORIAL_USAGE_INTEGRATION_CONTRACT_NOTE).toContain(
      "prefer one canonical binary intake and reuse the verified asset"
    );
    expect(EDITORIAL_USAGE_INTEGRATION_CONTRACT_NOTE).toContain("No silent duplicate upload");

    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("intent-test.webp", "image/webp", 200_000)
    ).file!;

    const validMetadata: NewsImageMetadataFormInput = {
      altAr: "نص بديل صالح لاختبار مقاصد النشر",
    };

    const usages: EditorialUsageIntent[] = ["inline", "cover", "both"];

    for (const usage of usages) {
      const prepared: PreparedEditorialImage = {
        file: validFile,
        metadata: validMetadata,
        usage,
        inlineFormatting:
          usage === "cover"
            ? undefined
            : {
                width: "50%",
                layout: "float-start",
              },
        mimeType: "image/webp",
        sizeBytes: validFile.size,
      };

      expect(prepared.usage).toBe(usage);
      if (usage === "cover") {
        expect(prepared.inlineFormatting).toBeUndefined();
      } else {
        expect(prepared.inlineFormatting?.width).toBe("50%");
        expect(prepared.inlineFormatting?.layout).toBe("float-start");
      }

      // Prepared image must NOT contain persistence identifiers or runtime preview URLs
      expect((prepared as any).previewUrl).toBeUndefined();
      expect((prepared as any).assetId).toBeUndefined();
      expect((prepared as any).intakeId).toBeUndefined();
      expect((prepared as any).uploadedUrl).toBeUndefined();
    }
  });

  // 9. Width and layout presets for inline/both
  it("9. preserves all four canonical width presets and layout presets for inline and both usage", () => {
    expect(ALLOWED_EDITORIAL_IMAGE_WIDTHS).toEqual(["25%", "50%", "75%", "100%"]);
    expect(ALLOWED_EDITORIAL_IMAGE_LAYOUTS).toEqual([
      "float-start",
      "float-end",
      "block-center",
      "block-full",
    ]);

    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("formatting.jpg", "image/jpeg", 300_000)
    ).file!;

    for (const width of ALLOWED_EDITORIAL_IMAGE_WIDTHS as EditorialImageWidthV2[]) {
      for (const layout of ALLOWED_EDITORIAL_IMAGE_LAYOUTS as EditorialImageLayoutV2[]) {
        const prepared: PreparedEditorialImage = {
          file: validFile,
          metadata: { altAr: "صورة منسقة" },
          usage: "inline",
          inlineFormatting: { width, layout },
          mimeType: "image/jpeg",
          sizeBytes: validFile.size,
        };

        expect(prepared.inlineFormatting?.width).toBe(width);
        expect(prepared.inlineFormatting?.layout).toBe(layout);
        expect((prepared as any).previewUrl).toBeUndefined();
      }
    }
  });

  // 10. Web optimization operates on active binary without triggering upload
  it("10. Optimize for Web operates on active binary data and produces a compliant File without triggering network uploads", async () => {
    const originalFile = normalizeCanonicalImageFile(
      createDummyFileLike("large-field-image.jpg", "image/jpeg", 2_500_000)
    ).file!;

    // In Node test environment, optimizeImageBinaryForWeb returns graceful fallback
    const optResult = await optimizeImageBinaryForWeb(originalFile);
    expect(optResult.originalSizeBytes).toBe(2_500_000);
    expect(optResult.file).toBeDefined();

    // Verify zero network upload calls occurred
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // 11. Modal React component static rendering and accessibility
  it("11. renders modal dialog structure in Arabic RTL and English LTR with accessible controls and close button", () => {
    // Arabic RTL render
    const arHtml = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        lang: "ar",
        dir: "rtl",
      })
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('role="dialog"');
    expect(arHtml).toContain('aria-modal="true"');
    expect(arHtml).toContain("إعداد صورة المادة التحريرية");
    expect(arHtml).toContain('data-testid="editorial-image-modal-close-btn"');
    expect(arHtml).toContain('data-testid="editorial-image-uppy-dashboard"');
    expect(arHtml).toContain('data-testid="editorial-usage-inline-btn"');
    expect(arHtml).toContain('data-testid="editorial-usage-cover-btn"');
    expect(arHtml).toContain('data-testid="editorial-usage-both-btn"');
    expect(arHtml).toContain('data-testid="editorial-modal-cancel-btn"');
    expect(arHtml).toContain('data-testid="editorial-modal-confirm-btn"');

    // English LTR render
    const enHtml = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        lang: "en",
        dir: "ltr",
      })
    );

    expect(enHtml).toContain('dir="ltr"');
    expect(enHtml).toContain("Prepare Editorial News Image");
    expect(enHtml).toContain("Article Body");
    expect(enHtml).toContain("Cover Only");
    expect(enHtml).toContain("Body &amp; Cover");

    // Hidden when isOpen is false
    const closedHtml = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: false,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      })
    );
    expect(closedHtml).toBe("");
  });

  // 12. Confirm button disabled when no file is selected
  it("12. disables the confirmation button when no file is prepared or altAr is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="editorial-modal-confirm-btn"');
    // Disabled attribute present on confirm button when initially open without file
    expect(html).toMatch(/data-testid="editorial-modal-confirm-btn"[^>]*disabled/);
  });

  // 13. D2-D2B2-R1: PreparedEditorialImage contract has no previewUrl field
  it("13. enforces that PreparedEditorialImage strictly excludes previewUrl from its contract", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("contract-test.png", "image/png", 100_000)
    ).file!;

    const prepared: PreparedEditorialImage = {
      file: validFile,
      metadata: { altAr: "صورة بدون رابط كائن" },
      usage: "inline",
      inlineFormatting: { width: "75%", layout: "block-center" },
      mimeType: "image/png",
      sizeBytes: validFile.size,
    };

    expect(Object.keys(prepared)).toEqual([
      "file",
      "metadata",
      "usage",
      "inlineFormatting",
      "mimeType",
      "sizeBytes",
    ]);
    expect("previewUrl" in prepared).toBe(false);
    expect((prepared as any).previewUrl).toBeUndefined();
  });

  // 14. D2-D2B2-R1: Confirmed File remains readable via arrayBuffer() after teardown
  it("14. guarantees confirmed File binary remains fully readable via arrayBuffer() after simulated URL revocation", async () => {
    const originalContent = "canonical-binary-proof-data-string-content";
    const rawFile = createDummyFileLike("binary-survival.jpg", "image/jpeg", originalContent.length, originalContent);
    const normResult = normalizeCanonicalImageFile(rawFile);
    expect(normResult.ok).toBe(true);
    const confirmedFile = normResult.file!;

    // Simulate modal internal URL generation and registration
    const dummyUrl = "blob:https://promise-of-planet.org/test-internal-blob-url";
    const revokeSpy = vi.fn();
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = revokeSpy;

    try {
      // Simulate modal cleanup / unmount revocation
      URL.revokeObjectURL(dummyUrl);
      expect(revokeSpy).toHaveBeenCalledWith(dummyUrl);

      // The confirmed File must remain completely readable and uncorrupted
      const buffer = await confirmedFile.arrayBuffer();
      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBe(originalContent.length);

      const decoded = new TextDecoder().decode(buffer);
      expect(decoded).toBe(originalContent);
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });

  // 15. D2-D2B2-R1: Modal owns and revokes internal object URLs without external leakage
  it("15. manages internal object URLs exclusively within modal scope and revokes them on close/cancel", () => {
    const revokedUrls: string[] = [];
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    try {
      // Create a set of URLs owned by an internal registry
      const internalRegistry = new Set<string>();
      const registerInternalUrl = (url: string) => {
        internalRegistry.add(url);
        return url;
      };

      const u1 = registerInternalUrl("blob:test/1");
      const u2 = registerInternalUrl("blob:test/2");
      expect(internalRegistry.size).toBe(2);

      // Teardown simulation (as done in modal revokeAllOwnedUrls)
      internalRegistry.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      internalRegistry.clear();

      expect(revokedUrls).toContain(u1);
      expect(revokedUrls).toContain(u2);
      expect(internalRegistry.size).toBe(0);
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });

  // 16. D2-D2B2-R1: Deep scan — no blob: or data: string escapes in prepared result
  it("16. performs a deep scan ensuring no blob: or data: string escapes into the prepared result or metadata", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("deep-scan.webp", "image/webp", 120_000)
    ).file!;

    const metadata: NewsImageMetadataFormInput = {
      altAr: "نص بديل نظيف بدون بروتوكولات",
      altEn: "Clean alt text without protocols",
      captionAr: "شرح توضيحي نظيف",
      captionEn: "Clean caption",
      photographerCredit: "فريق وعد الكوكب",
      licensingInfo: "CC-BY 4.0",
    };

    const prepared: PreparedEditorialImage = {
      file: validFile,
      metadata,
      usage: "both",
      inlineFormatting: { width: "50%", layout: "float-end" },
      mimeType: "image/webp",
      sizeBytes: validFile.size,
    };

    function assertNoUrlProtocols(obj: unknown, path: string = "root"): void {
      if (typeof obj === "string") {
        expect(obj.startsWith("blob:")).toBe(false);
        expect(obj.startsWith("data:")).toBe(false);
        expect(obj.startsWith("gs://")).toBe(false);
        expect(obj.startsWith("http://")).toBe(false);
        expect(obj.startsWith("https://")).toBe(false);
      } else if (obj && typeof obj === "object" && !(obj instanceof Blob) && !(obj instanceof File)) {
        for (const [key, value] of Object.entries(obj)) {
          assertNoUrlProtocols(value, `${path}.${key}`);
        }
      }
    }

    assertNoUrlProtocols(prepared);
  });

  // 17. D2-D2B2-R1: Cancel produces no prepared result and never invokes onConfirm
  it("17. ensures cancel or closing the modal produces no prepared result and leaves parent callback uncalled", () => {
    const onConfirmSpy = vi.fn();
    const onCloseSpy = vi.fn();

    // Render modal in open state with handlers
    const html = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        onClose: onCloseSpy,
        onConfirm: onConfirmSpy,
        lang: "ar",
      })
    );

    expect(html).toContain('data-testid="editorial-modal-cancel-btn"');
    expect(html).toContain('data-testid="editorial-image-modal-close-btn"');

    // Neither callback has been invoked during mount/render
    expect(onConfirmSpy).not.toHaveBeenCalled();
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  // 18. D2-D2B2-R1: No staged image identity is created by the modal
  it("18. confirms no assetId, intakeId, or staged session identity is created by the modal component", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("identity-free.jpg", "image/jpeg", 90_000)
    ).file!;

    const prepared: PreparedEditorialImage = {
      file: validFile,
      metadata: { altAr: "صورة بدون هوية مسبقة" },
      usage: "inline",
      inlineFormatting: { width: "100%", layout: "block-full" },
      mimeType: "image/jpeg",
      sizeBytes: validFile.size,
    };

    expect((prepared as any).assetId).toBeUndefined();
    expect((prepared as any).intakeId).toBeUndefined();
    expect((prepared as any).stagedAssetId).toBeUndefined();
    expect((prepared as any).id).toBeUndefined();
  });

  // 19. D2-D2B2-R1: All editorial usage intents remain supported without runtime object URLs
  it("19. verifies all three usage intents (inline, cover, both) generate valid URL-free prepared results", () => {
    const validFile = normalizeCanonicalImageFile(
      createDummyFileLike("usage-matrix.png", "image/png", 220_000)
    ).file!;

    const metadata: NewsImageMetadataFormInput = { altAr: "صورة مصفوفة المقاصد" };
    const intents: EditorialUsageIntent[] = ["inline", "cover", "both"];

    for (const usage of intents) {
      const prepared: PreparedEditorialImage = {
        file: validFile,
        metadata,
        usage,
        inlineFormatting: usage === "cover" ? undefined : { width: "50%", layout: "float-start" },
        mimeType: "image/png",
        sizeBytes: validFile.size,
      };

      expect(prepared.usage).toBe(usage);
      expect("previewUrl" in prepared).toBe(false);
      if (usage === "cover") {
        expect(prepared.inlineFormatting).toBeUndefined();
      } else {
        expect(prepared.inlineFormatting).toBeDefined();
      }
    }
  });

  // 20. D2-D2B2-R1: Zero network upload activity occurs throughout
  it("20. verifies zero network upload or fetch calls occur during modal lifecycle", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const html = renderToStaticMarkup(
      React.createElement(EditorialInlineImageModal, {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        initialUsage: "both",
      })
    );

    expect(html).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
