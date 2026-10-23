import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Trash2,
  AlignRight,
  AlignLeft,
  AlignCenter,
  Maximize,
  GripVertical,
  ShieldAlert,
  Image as ImageIcon,
} from "lucide-react";
import type {
  EditorialImageNodeAttrsV2,
  ImageLayoutV2 as EditorialImageLayoutV2,
  ImageWidthV2 as EditorialImageWidthV2,
} from "../../../types/richNewsDocument";

export type { EditorialImageLayoutV2, EditorialImageWidthV2 };

/* ==========================================
 * Constants & Validation Rules (V2 Canonical)
 * ========================================== */

export const ALLOWED_EDITORIAL_IMAGE_WIDTHS: readonly EditorialImageWidthV2[] = [
  "25%",
  "50%",
  "75%",
  "100%",
] as const;

export const ALLOWED_EDITORIAL_IMAGE_LAYOUTS: readonly EditorialImageLayoutV2[] = [
  "float-start",
  "float-end",
  "block-center",
  "block-full",
] as const;

export const ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS = new Set<string>([
  "assetId",
  "altAr",
  "altEn",
  "captionAr",
  "captionEn",
  "width",
  "layout",
]);

export const FORBIDDEN_EDITORIAL_IMAGE_ATTR_KEYS = new Set<string>([
  "src",
  "publicUrl",
  "storagePath",
  "credit",
  "title",
  "alt",
  "alignment",
  "href",
  "style",
  "class",
]);

const SAFE_ASSET_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function containsForbiddenUrlOrStoragePattern(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.startsWith("gs://") ||
    lower.includes("storage.googleapis.com") ||
    lower.includes("firebasestorage.googleapis.com")
  );
}

export interface EditorialImageAttrValidationResult {
  valid: boolean;
  errors: string[];
  attrs?: EditorialImageNodeAttrsV2;
}

/**
 * Validates candidate attributes strictly against the canonical V2 contract.
 * Unknown or malformed attributes fail closed.
 */
export function validateCanonicalEditorialImageAttrs(
  input: unknown
): EditorialImageAttrValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["editorialImage attrs must be a non-null object."],
    };
  }

  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS.has(key)) {
      errors.push(`Disallowed or unknown attribute "${key}" on editorialImage node.`);
    }
  }

  const assetId = raw.assetId;
  if (
    typeof assetId !== "string" ||
    !SAFE_ASSET_ID_REGEX.test(assetId) ||
    containsForbiddenUrlOrStoragePattern(assetId)
  ) {
    errors.push(
      "editorialImage assetId must be a non-empty path-safe string (1-128 chars)."
    );
  }

  const altAr = raw.altAr;
  if (
    typeof altAr !== "string" ||
    altAr.trim().length === 0 ||
    altAr.length > 500 ||
    containsForbiddenUrlOrStoragePattern(altAr)
  ) {
    errors.push(
      "editorialImage altAr must be a non-empty string up to 500 chars without embedded URLs or storage paths."
    );
  }

  const width = raw.width;
  if (
    typeof width !== "string" ||
    !ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(width as EditorialImageWidthV2)
  ) {
    errors.push("editorialImage width must be one of: 25%, 50%, 75%, 100%.");
  }

  const layout = raw.layout;
  if (
    typeof layout !== "string" ||
    !ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(layout as EditorialImageLayoutV2)
  ) {
    errors.push(
      "editorialImage layout must be one of: float-start, float-end, block-center, block-full."
    );
  }

  if (raw.altEn !== undefined && raw.altEn !== null) {
    if (
      typeof raw.altEn !== "string" ||
      raw.altEn.length > 500 ||
      containsForbiddenUrlOrStoragePattern(raw.altEn)
    ) {
      errors.push(
        "editorialImage altEn must be a string up to 500 chars without embedded URLs or storage paths."
      );
    }
  }

  if (raw.captionAr !== undefined && raw.captionAr !== null) {
    if (
      typeof raw.captionAr !== "string" ||
      raw.captionAr.length > 1000 ||
      containsForbiddenUrlOrStoragePattern(raw.captionAr)
    ) {
      errors.push(
        "editorialImage captionAr must be a string up to 1000 chars without embedded URLs or storage paths."
      );
    }
  }

  if (raw.captionEn !== undefined && raw.captionEn !== null) {
    if (
      typeof raw.captionEn !== "string" ||
      raw.captionEn.length > 1000 ||
      containsForbiddenUrlOrStoragePattern(raw.captionEn)
    ) {
      errors.push(
        "editorialImage captionEn must be a string up to 1000 chars without embedded URLs or storage paths."
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const canonicalAttrs: EditorialImageNodeAttrsV2 = {
    assetId: assetId as string,
    altAr: altAr as string,
    width: width as EditorialImageWidthV2,
    layout: layout as EditorialImageLayoutV2,
  };

  if (typeof raw.altEn === "string") {
    canonicalAttrs.altEn = raw.altEn;
  }
  if (typeof raw.captionAr === "string") {
    canonicalAttrs.captionAr = raw.captionAr;
  }
  if (typeof raw.captionEn === "string") {
    canonicalAttrs.captionEn = raw.captionEn;
  }

  return {
    valid: true,
    errors: [],
    attrs: canonicalAttrs,
  };
}

/* ==========================================
 * Runtime Preview Context & Ownership-Safe URL Cleanup
 * ========================================== */

export interface EditorialImageLocaleContextValue {
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}

export const EditorialImageLocaleContext =
  createContext<EditorialImageLocaleContextValue>({
    lang: "ar",
    dir: "rtl",
  });

export interface EditorialImagePreviewContextValue {
  /**
   * Runtime-only mapping from canonical `assetId` to an authorized preview URL.
   * Never persisted into ProseMirror/Tiptap document attributes.
   */
  previewUrlsByAssetId: Readonly<Record<string, string | undefined>>;
}

export const EditorialImagePreviewContext =
  createContext<EditorialImagePreviewContextValue>({
    previewUrlsByAssetId: {},
  });

/**
 * Validates that a runtime preview URL is safe to render in an <img> tag.
 * Rejects executable schemes such as javascript:, vbscript:, or non-image data: URLs.
 */
export function isSafeRuntimePreviewUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return false;
  }

  if (lower.startsWith("data:")) {
    return /^data:image\/(jpeg|jpg|png|webp|avif|gif|svg\+xml);/i.test(trimmed);
  }

  if (
    lower.startsWith("blob:") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("/")
  ) {
    return true;
  }

  return false;
}

export interface OwnedPreviewUrlRegistry {
  /**
   * Registers a temporary preview URL (e.g. `blob:`) created and owned by this session.
   * If a previous owned URL existed for the same assetId, it is revoked first.
   */
  registerOwnedPreviewUrl: (assetId: string, url: string) => void;
  /**
   * Associates a preview URL owned by an external caller/component.
   * Cleanup methods on this registry will NEVER revoke external URLs.
   */
  registerExternalPreviewUrl: (assetId: string, url: string) => void;
  /**
   * Revokes and removes the preview URL for a specific assetId ONLY if owned by this registry.
   * If the URL was registered as external, removes the mapping without revoking the underlying URL.
   */
  releaseAssetPreviewUrl: (assetId: string) => void;
  /**
   * Revokes all URLs explicitly owned by this registry and clears the map.
   * Never revokes URLs owned by other components.
   */
  revokeAllOwnedPreviewUrls: () => void;
  /**
   * Returns whether the current URL for `assetId` is owned by this registry.
   */
  isUrlOwned: (assetId: string) => boolean;
  /**
   * Returns a snapshot of the runtime `assetId -> previewUrl` mapping.
   */
  getPreviewMap: () => Record<string, string>;
}

/**
 * Creates an ownership-tracking runtime preview URL registry.
 * Ensures `URL.revokeObjectURL` is only called on URLs explicitly owned by this registry.
 */
export function createOwnedPreviewUrlRegistry(
  revokeFn: (url: string) => void = (url) => {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }
): OwnedPreviewUrlRegistry {
  const urlsByAssetId = new Map<string, string>();
  const ownedUrls = new Set<string>();

  return {
    registerOwnedPreviewUrl(assetId: string, url: string) {
      if (!SAFE_ASSET_ID_REGEX.test(assetId) || !isSafeRuntimePreviewUrl(url)) {
        return;
      }
      const existing = urlsByAssetId.get(assetId);
      if (existing && existing !== url && ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.set(assetId, url);
      ownedUrls.add(url);
    },

    registerExternalPreviewUrl(assetId: string, url: string) {
      if (!SAFE_ASSET_ID_REGEX.test(assetId) || !isSafeRuntimePreviewUrl(url)) {
        return;
      }
      const existing = urlsByAssetId.get(assetId);
      if (existing && existing !== url && ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.set(assetId, url);
    },

    releaseAssetPreviewUrl(assetId: string) {
      const existing = urlsByAssetId.get(assetId);
      if (!existing) return;
      if (ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.delete(assetId);
    },

    revokeAllOwnedPreviewUrls() {
      for (const ownedUrl of ownedUrls) {
        revokeFn(ownedUrl);
      }
      ownedUrls.clear();
      urlsByAssetId.clear();
    },

    isUrlOwned(assetId: string): boolean {
      const existing = urlsByAssetId.get(assetId);
      return Boolean(existing && ownedUrls.has(existing));
    },

    getPreviewMap(): Record<string, string> {
      return Object.fromEntries(urlsByAssetId.entries());
    },
  };
}

/* ==========================================
 * Container-Responsive Layout & Toolbar Clamping Helpers
 * ========================================== */

/**
 * Container-width thresholds for article editor content (in px).
 * - Narrow (< 640px): floated images render as centered independent blocks with no text wrapping.
 * - Medium (640px to < 1024px): floated images wrap only when at least MIN_READABLE_PARAGRAPH_WIDTH_PX
 *   of horizontal width remains for adjacent text; otherwise they render as centered blocks.
 * - Wide (>= 1024px): floated images honor their saved canonical float layout.
 */
export const NARROW_EDITOR_CONTAINER_MAX_PX = 640;
export const WIDE_EDITOR_CONTAINER_MIN_PX = 1024;
export const MIN_READABLE_PARAGRAPH_WIDTH_PX = 320;
export const EDITORIAL_IMAGE_FLOAT_GAP_PX = 20;
export const COMPACT_TOOLBAR_MAX_CONTAINER_PX = 360;

export type EditorialImageContainerTier = "narrow" | "medium" | "wide";

export interface EditorialImageResponsivePresentation {
  canonicalLayout: EditorialImageLayoutV2;
  canonicalWidth: EditorialImageWidthV2;
  effectiveRenderLayout: EditorialImageLayoutV2;
  containerTier: EditorialImageContainerTier;
  isFloatCollapsed: boolean;
  remainingTextWidthPx: number | null;
  style: React.CSSProperties;
}

/**
 * Responsive text-wrapping and container-collapse CSS.
 * Respects `data-float-collapsed="true"` for container-aware collapse while preserving
 * canonical `data-layout` and `data-width` attributes untouched.
 */
export const EDITORIAL_IMAGE_LAYOUT_CSS = `
  [dir="rtl"] .pop-layout-float-start:not([data-float-collapsed="true"]),
  [dir="rtl"] figure[data-layout="float-start"]:not([data-float-collapsed="true"]) {
    float: right;
    margin-left: 1.25rem;
    margin-right: 0;
    margin-bottom: 0.75rem;
    margin-top: 0.25rem;
  }

  [dir="rtl"] .pop-layout-float-end:not([data-float-collapsed="true"]),
  [dir="rtl"] figure[data-layout="float-end"]:not([data-float-collapsed="true"]) {
    float: left;
    margin-right: 1.25rem;
    margin-left: 0;
    margin-bottom: 0.75rem;
    margin-top: 0.25rem;
  }

  [dir="ltr"] .pop-layout-float-start:not([data-float-collapsed="true"]),
  [dir="ltr"] figure[data-layout="float-start"]:not([data-float-collapsed="true"]) {
    float: left;
    margin-right: 1.25rem;
    margin-left: 0;
    margin-bottom: 0.75rem;
    margin-top: 0.25rem;
  }

  [dir="ltr"] .pop-layout-float-end:not([data-float-collapsed="true"]),
  [dir="ltr"] figure[data-layout="float-end"]:not([data-float-collapsed="true"]) {
    float: right;
    margin-left: 1.25rem;
    margin-right: 0;
    margin-bottom: 0.75rem;
    margin-top: 0.25rem;
  }

  .pop-layout-block-center,
  figure[data-layout="block-center"],
  figure[data-float-collapsed="true"] {
    float: none !important;
    display: block !important;
    clear: both !important;
    margin-left: auto !important;
    margin-right: auto !important;
    margin-top: 0.75rem !important;
    margin-bottom: 0.75rem !important;
  }

  .pop-layout-block-full,
  figure[data-layout="block-full"] {
    float: none !important;
    display: block !important;
    clear: both !important;
    width: 100% !important;
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    margin-top: 0.75rem !important;
    margin-bottom: 0.75rem !important;
  }

  @media (max-width: 640px) {
    .editorial-image-node-wrapper[data-layout="float-start"],
    .editorial-image-node-wrapper[data-layout="float-end"],
    .pop-editorial-figure[data-layout="float-start"],
    .pop-editorial-figure[data-layout="float-end"] {
      float: none !important;
      display: block !important;
      max-width: 100% !important;
      margin-left: auto !important;
      margin-right: auto !important;
      margin-bottom: 0.75rem !important;
      clear: both !important;
    }
  }
`;

function parseCanonicalWidthRatio(width: EditorialImageWidthV2): number {
  switch (width) {
    case "25%":
      return 0.25;
    case "50%":
      return 0.5;
    case "75%":
      return 0.75;
    case "100%":
      return 1;
  }
}

/**
 * Resolves container-aware presentation for an editorialImage node without mutating
 * its saved canonical V2 `layout` or `width` attributes.
 */
export function resolveEditorialImageResponsivePresentation(
  layout: EditorialImageLayoutV2,
  width: EditorialImageWidthV2,
  isRtl: boolean,
  containerWidthPx?: number | null
): EditorialImageResponsivePresentation {
  const canonicalLayout: EditorialImageLayoutV2 =
    ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(layout) ? layout : "float-start";
  const canonicalWidth: EditorialImageWidthV2 =
    ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(width) ? width : "50%";

  const hasMeasuredContainer =
    typeof containerWidthPx === "number" &&
    Number.isFinite(containerWidthPx) &&
    containerWidthPx > 0;

  const containerTier: EditorialImageContainerTier = !hasMeasuredContainer
    ? "wide"
    : containerWidthPx < NARROW_EDITOR_CONTAINER_MAX_PX
      ? "narrow"
      : containerWidthPx < WIDE_EDITOR_CONTAINER_MIN_PX
        ? "medium"
        : "wide";

  const isFloatIntent =
    canonicalLayout === "float-start" || canonicalLayout === "float-end";

  if (canonicalLayout === "block-full" || (isFloatIntent && canonicalWidth === "100%")) {
    return {
      canonicalLayout,
      canonicalWidth,
      effectiveRenderLayout: "block-full",
      containerTier,
      isFloatCollapsed: false,
      remainingTextWidthPx: null,
      style: {
        float: "none",
        display: "block",
        clear: "both",
        width: "100%",
        maxWidth: "100%",
        marginLeft: "0",
        marginRight: "0",
        marginTop: isFloatIntent ? undefined : "0.75rem",
        marginBottom: "0.75rem",
      },
    };
  }

  if (canonicalLayout === "block-center") {
    return {
      canonicalLayout,
      canonicalWidth,
      effectiveRenderLayout: "block-center",
      containerTier,
      isFloatCollapsed: false,
      remainingTextWidthPx: null,
      style: {
        float: "none",
        display: "block",
        clear: "both",
        width: canonicalWidth,
        maxWidth: "100%",
        marginLeft: "auto",
        marginRight: "auto",
        marginTop: "0.75rem",
        marginBottom: "0.75rem",
      },
    };
  }

  // Float layout (float-start or float-end) with width 25%, 50%, or 75%
  const widthRatio = parseCanonicalWidthRatio(canonicalWidth);
  const remainingTextWidthPx = hasMeasuredContainer
    ? Math.max(
        0,
        Math.round(
          containerWidthPx * (1 - widthRatio) - EDITORIAL_IMAGE_FLOAT_GAP_PX
        )
      )
    : null;

  const shouldCollapseFloat =
    containerTier === "narrow" ||
    (containerTier === "medium" &&
      remainingTextWidthPx !== null &&
      remainingTextWidthPx < MIN_READABLE_PARAGRAPH_WIDTH_PX);

  if (shouldCollapseFloat) {
    return {
      canonicalLayout,
      canonicalWidth,
      effectiveRenderLayout: "block-center",
      containerTier,
      isFloatCollapsed: true,
      remainingTextWidthPx,
      style: {
        float: "none",
        display: "block",
        clear: "both",
        width: canonicalWidth,
        maxWidth: "100%",
        marginLeft: "auto",
        marginRight: "auto",
        marginTop: "0.75rem",
        marginBottom: "0.75rem",
      },
    };
  }

  if (canonicalLayout === "float-start") {
    return {
      canonicalLayout,
      canonicalWidth,
      effectiveRenderLayout: "float-start",
      containerTier,
      isFloatCollapsed: false,
      remainingTextWidthPx,
      style: isRtl
        ? {
            float: "right",
            width: canonicalWidth,
            maxWidth: "100%",
            marginLeft: "1.25rem",
            marginRight: "0",
            marginBottom: "0.75rem",
          }
        : {
            float: "left",
            width: canonicalWidth,
            maxWidth: "100%",
            marginRight: "1.25rem",
            marginLeft: "0",
            marginBottom: "0.75rem",
          },
    };
  }

  // float-end
  return {
    canonicalLayout,
    canonicalWidth,
    effectiveRenderLayout: "float-end",
    containerTier,
    isFloatCollapsed: false,
    remainingTextWidthPx,
    style: isRtl
      ? {
          float: "left",
          width: canonicalWidth,
          maxWidth: "100%",
          marginRight: "1.25rem",
          marginLeft: "0",
          marginBottom: "0.75rem",
        }
      : {
          float: "right",
          width: canonicalWidth,
          maxWidth: "100%",
          marginLeft: "1.25rem",
          marginRight: "0",
          marginBottom: "0.75rem",
        },
  };
}

/**
 * Computes inline float and margin styles for RTL and LTR article flow,
 * honoring container-aware responsive collapse when `containerWidthPx` is provided.
 */
export function computeEditorialImageFloatStyle(
  layout: EditorialImageLayoutV2,
  width: EditorialImageWidthV2,
  isRtl: boolean,
  containerWidthPx?: number | null
): React.CSSProperties {
  return resolveEditorialImageResponsivePresentation(
    layout,
    width,
    isRtl,
    containerWidthPx
  ).style;
}

export interface ToolbarBoundsInput {
  figureRect: { top: number; bottom: number; left: number; right: number; width: number };
  editorRect: { top: number; bottom: number; left: number; right: number; width: number };
  toolbarWidth: number;
  toolbarHeight: number;
  edgePadding?: number;
}

export interface ToolbarBoundsComputation {
  shiftX: number;
  placement: "above" | "below" | "inside-top";
  maxWidthPx: number;
  effectiveToolbarWidth: number;
  isCompact: boolean;
  clampedLeft: number;
  clampedRight: number;
}

/**
 * Clamps the contextual toolbar horizontally within the visible editor content area,
 * caps its maximum width when the editor is narrower than the natural toolbar width,
 * and flips placement from "above" to "below" (or "inside-top" when both vertical edges are tight)
 * to prevent ancestor overflow clipping.
 */
export function computeToolbarClampedPosition({
  figureRect,
  editorRect,
  toolbarWidth,
  toolbarHeight,
  edgePadding = 8,
}: ToolbarBoundsInput): ToolbarBoundsComputation {
  const padding =
    typeof edgePadding === "number" && Number.isFinite(edgePadding) && edgePadding >= 0
      ? edgePadding
      : 8;

  const minLeftBoundary = editorRect.left + padding;
  const maxRightBoundary = Math.max(minLeftBoundary, editorRect.right - padding);
  const availableEditorWidth = Math.max(0, maxRightBoundary - minLeftBoundary);
  const maxWidthPx = availableEditorWidth;

  const safeToolbarWidth = Math.max(0, toolbarWidth);
  const effectiveToolbarWidth =
    availableEditorWidth > 0
      ? Math.min(safeToolbarWidth, availableEditorWidth)
      : safeToolbarWidth;

  const isCompact =
    (availableEditorWidth > 0 &&
      availableEditorWidth < COMPACT_TOOLBAR_MAX_CONTAINER_PX) ||
    (availableEditorWidth > 0 && safeToolbarWidth > availableEditorWidth);

  const figureCenterX = figureRect.left + figureRect.width / 2;
  const idealLeft = figureCenterX - effectiveToolbarWidth / 2;
  const idealRight = figureCenterX + effectiveToolbarWidth / 2;

  let shiftX = 0;
  if (availableEditorWidth > 0 && effectiveToolbarWidth >= availableEditorWidth) {
    const editorCenterX = (minLeftBoundary + maxRightBoundary) / 2;
    shiftX = editorCenterX - figureCenterX;
  } else if (idealLeft < minLeftBoundary) {
    shiftX = minLeftBoundary - idealLeft;
  } else if (idealRight > maxRightBoundary) {
    shiftX = maxRightBoundary - idealRight;
  }

  const clampedLeft = idealLeft + shiftX;
  const clampedRight = idealRight + shiftX;

  const availableTopSpace = figureRect.top - editorRect.top;
  const availableBottomSpace = editorRect.bottom - figureRect.bottom;
  const requiredVerticalSpace = Math.max(toolbarHeight, 36) + 12;

  let placement: "above" | "below" | "inside-top" = "above";
  if (availableTopSpace < requiredVerticalSpace) {
    if (
      availableBottomSpace >= requiredVerticalSpace ||
      availableBottomSpace >= availableTopSpace
    ) {
      placement =
        availableBottomSpace < 24 && availableTopSpace < 24
          ? "inside-top"
          : "below";
    } else {
      placement = "inside-top";
    }
  }

  return {
    shiftX,
    placement,
    maxWidthPx,
    effectiveToolbarWidth,
    isCompact,
    clampedLeft,
    clampedRight,
  };
}

/* ==========================================
 * NodeView Interactive Action Handlers
 * ========================================== */

export interface EditorialImageNodeActionConfig {
  effectiveWidth: EditorialImageWidthV2;
  effectiveLayout: EditorialImageLayoutV2;
  isAr: boolean;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  deleteNode: () => void;
}

export interface EditorialImageNodeActions {
  handleSetWidth: (newWidth: EditorialImageWidthV2) => void;
  handleSetLayout: (newLayout: EditorialImageLayoutV2) => void;
  handleCaptionChange: (value: string) => void;
  handleDeleteNode: () => void;
}

/**
 * Creates canonical V2 attribute mutation and deletion callbacks for the NodeView toolbar.
 * Guarantees that only allowed V2 attributes (`width`, `layout`, `captionAr`, `captionEn`)
 * are updated and never introduces legacy `alignment` or `src` keys.
 */
export function createEditorialImageNodeActions({
  effectiveWidth,
  effectiveLayout,
  isAr,
  updateAttributes,
  deleteNode,
}: EditorialImageNodeActionConfig): EditorialImageNodeActions {
  return {
    handleSetWidth(newWidth: EditorialImageWidthV2) {
      if (!ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(newWidth)) return;
      if (newWidth === "100%" && effectiveLayout !== "block-full") {
        updateAttributes({ width: "100%", layout: "block-full" });
      } else {
        updateAttributes({ width: newWidth });
      }
    },

    handleSetLayout(newLayout: EditorialImageLayoutV2) {
      if (!ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(newLayout)) return;
      if (newLayout === "block-full") {
        updateAttributes({ layout: "block-full", width: "100%" });
      } else if (effectiveWidth === "100%") {
        updateAttributes({ layout: newLayout, width: "50%" });
      } else {
        updateAttributes({ layout: newLayout });
      }
    },

    handleCaptionChange(value: string) {
      const sanitized = value.slice(0, 1000);
      if (containsForbiddenUrlOrStoragePattern(sanitized)) {
        return;
      }
      const nextValue = sanitized.length > 0 ? sanitized : null;
      if (isAr) {
        updateAttributes({ captionAr: nextValue });
      } else {
        updateAttributes({ captionEn: nextValue });
      }
    },

    handleDeleteNode() {
      deleteNode();
    },
  };
}

/* ==========================================
 * React NodeView Component
 * ========================================== */

export interface EditorialImageExtensionOptions {
  /**
   * Optional runtime preview lookup function or map.
   * Never persisted to document JSON or HTML attributes.
   */
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  getPreviewUrl?: (assetId: string) => string | undefined;
}

export function EditorialImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, extension } = props;

  const rawAttrs = (node.attrs || {}) as Partial<EditorialImageNodeAttrsV2>;
  const assetId = typeof rawAttrs.assetId === "string" ? rawAttrs.assetId : "";
  const altAr = typeof rawAttrs.altAr === "string" ? rawAttrs.altAr : "";
  const altEn = typeof rawAttrs.altEn === "string" ? rawAttrs.altEn : undefined;
  const captionAr =
    typeof rawAttrs.captionAr === "string" ? rawAttrs.captionAr : undefined;
  const captionEn =
    typeof rawAttrs.captionEn === "string" ? rawAttrs.captionEn : undefined;

  const effectiveWidth: EditorialImageWidthV2 =
    rawAttrs.width &&
    ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(rawAttrs.width as EditorialImageWidthV2)
      ? (rawAttrs.width as EditorialImageWidthV2)
      : "50%";

  const effectiveLayout: EditorialImageLayoutV2 =
    rawAttrs.layout &&
    ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(
      rawAttrs.layout as EditorialImageLayoutV2
    )
      ? (rawAttrs.layout as EditorialImageLayoutV2)
      : "float-start";

  const localeCtx = useContext(EditorialImageLocaleContext);
  const previewCtx = useContext(EditorialImagePreviewContext);

  const [isHovered, setIsHovered] = useState(false);
  const [measuredContainerWidth, setMeasuredContainerWidth] = useState<
    number | null
  >(null);
  const [toolbarShiftX, setToolbarShiftX] = useState(0);
  const [toolbarPlacement, setToolbarPlacement] = useState<
    "above" | "below" | "inside-top"
  >("above");
  const [toolbarMaxWidthPx, setToolbarMaxWidthPx] = useState<number | null>(null);
  const [isToolbarCompact, setIsToolbarCompact] = useState(false);

  const figureRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const domDir = editor?.view?.dom?.getAttribute?.("dir");
  const isRtl = domDir ? domDir === "rtl" : localeCtx.dir === "rtl";
  const isAr = domDir ? domDir === "rtl" : localeCtx.lang === "ar";

  // Resolve initial editor rect synchronously when available (supports SSR/static test harnesses and first paint)
  const fallbackEditorRect = (() => {
    try {
      return editor?.view?.dom?.getBoundingClientRect?.() ?? null;
    } catch {
      return null;
    }
  })();

  const effectiveContainerWidth =
    measuredContainerWidth ??
    (fallbackEditorRect &&
    typeof fallbackEditorRect.width === "number" &&
    fallbackEditorRect.width > 0
      ? Math.round(fallbackEditorRect.width)
      : null);

  // Resolve runtime-only preview URL strictly by assetId
  const extensionOptions = (extension?.options ||
    {}) as EditorialImageExtensionOptions;
  const candidatePreviewUrl =
    (assetId && previewCtx.previewUrlsByAssetId?.[assetId]) ??
    (assetId && extensionOptions.previewUrlsByAssetId?.[assetId]) ??
    (assetId && extensionOptions.getPreviewUrl?.(assetId)) ??
    undefined;

  const resolvedPreviewUrl = isSafeRuntimePreviewUrl(candidatePreviewUrl)
    ? candidatePreviewUrl
    : undefined;

  const activeAltText = isAr ? altAr || altEn || "" : altEn || altAr || "";
  const activeCaptionText = isAr
    ? captionAr ?? captionEn ?? ""
    : captionEn ?? captionAr ?? "";

  const showToolbar = Boolean(selected || isHovered);

  const recalculateLayoutAndToolbar = useCallback(() => {
    const editorDom = editor?.view?.dom;
    const editorRect = editorDom?.getBoundingClientRect?.();
    if (
      editorRect &&
      typeof editorRect.width === "number" &&
      editorRect.width > 0
    ) {
      const nextContainerWidth = Math.round(editorRect.width);
      setMeasuredContainerWidth((prev) =>
        prev === nextContainerWidth ? prev : nextContainerWidth
      );
    }

    const figureEl = figureRef.current;
    const toolbarEl = toolbarRef.current;
    if (!figureEl || !toolbarEl || !editorRect) return;

    const figureRect = figureEl.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();

    const computed = computeToolbarClampedPosition({
      figureRect,
      editorRect,
      toolbarWidth: toolbarRect.width,
      toolbarHeight: toolbarRect.height,
    });

    const nextShiftX = Math.round(computed.shiftX);
    const nextMaxWidthPx = Math.round(computed.maxWidthPx);

    setToolbarShiftX((prev) => (prev === nextShiftX ? prev : nextShiftX));
    setToolbarPlacement((prev) =>
      prev === computed.placement ? prev : computed.placement
    );
    setToolbarMaxWidthPx((prev) =>
      prev === nextMaxWidthPx ? prev : nextMaxWidthPx
    );
    setIsToolbarCompact((prev) =>
      prev === computed.isCompact ? prev : computed.isCompact
    );
  }, [editor]);

  // Observe editor content container and figure resize events for container-aware responsive layout
  useEffect(() => {
    recalculateLayoutAndToolbar();

    const editorDom = editor?.view?.dom;
    const figureEl = figureRef.current;

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        recalculateLayoutAndToolbar();
      });
      if (editorDom && typeof Node !== "undefined" && editorDom instanceof globalThis.Element) {
        resizeObserver.observe(editorDom);
      }
      if (figureEl && typeof Node !== "undefined" && figureEl instanceof globalThis.Element) {
        resizeObserver.observe(figureEl);
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", recalculateLayoutAndToolbar);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", recalculateLayoutAndToolbar);
      }
    };
  }, [editor, effectiveWidth, effectiveLayout, isRtl, recalculateLayoutAndToolbar]);

  // Recalculate toolbar clamping on selection/hover and scroll
  useEffect(() => {
    if (!showToolbar) {
      setToolbarShiftX(0);
      setToolbarPlacement("above");
      return;
    }

    recalculateLayoutAndToolbar();
    const rafId =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(recalculateLayoutAndToolbar)
        : null;

    if (typeof window !== "undefined") {
      window.addEventListener("scroll", recalculateLayoutAndToolbar, true);
    }

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("scroll", recalculateLayoutAndToolbar, true);
      }
    };
  }, [
    showToolbar,
    effectiveWidth,
    effectiveLayout,
    isRtl,
    effectiveContainerWidth,
    recalculateLayoutAndToolbar,
  ]);

  const {
    handleSetWidth,
    handleSetLayout,
    handleCaptionChange,
    handleDeleteNode,
  } = createEditorialImageNodeActions({
    effectiveWidth,
    effectiveLayout,
    isAr,
    updateAttributes,
    deleteNode,
  });

  const presentation = resolveEditorialImageResponsivePresentation(
    effectiveLayout,
    effectiveWidth,
    isRtl,
    effectiveContainerWidth
  );
  const floatStyle = presentation.style;
  const layoutClass = `pop-layout-${presentation.effectiveRenderLayout}`;

  const fallbackAvailableToolbarWidth =
    fallbackEditorRect &&
    typeof fallbackEditorRect.right === "number" &&
    typeof fallbackEditorRect.left === "number" &&
    fallbackEditorRect.right > fallbackEditorRect.left
      ? Math.max(
          0,
          Math.round(fallbackEditorRect.right - fallbackEditorRect.left - 16)
        )
      : effectiveContainerWidth !== null
        ? Math.max(0, effectiveContainerWidth - 16)
        : null;

  const activeToolbarMaxWidthPx =
    toolbarMaxWidthPx ?? fallbackAvailableToolbarWidth;
  const activeIsToolbarCompact =
    isToolbarCompact ||
    (activeToolbarMaxWidthPx !== null &&
      activeToolbarMaxWidthPx > 0 &&
      activeToolbarMaxWidthPx < COMPACT_TOOLBAR_MAX_CONTAINER_PX);

  const toolbarVerticalClass =
    toolbarPlacement === "below"
      ? "top-full mt-2"
      : toolbarPlacement === "inside-top"
        ? "top-2"
        : "bottom-full mb-2";

  return (
    <NodeViewWrapper
      as="figure"
      ref={figureRef as any}
      data-testid="editorial-image-figure"
      data-drag-handle=""
      data-editorial-image=""
      data-asset-id={assetId}
      data-layout={effectiveLayout}
      data-width={effectiveWidth}
      data-presentation-layout={presentation.effectiveRenderLayout}
      data-container-tier={presentation.containerTier}
      data-float-collapsed={presentation.isFloatCollapsed ? "true" : "false"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={floatStyle}
      className={`editorial-image-node-wrapper pop-editorial-figure ${layoutClass} group relative transition-all rounded-lg border-2 my-2 ${
        selected
          ? "border-emerald-600 ring-4 ring-emerald-500/20 shadow-lg"
          : "border-transparent hover:border-emerald-300"
      }`}
    >
      <style>{EDITORIAL_IMAGE_LAYOUT_CSS}</style>

      {/* Contextual Floating Action Toolbar */}
      <div
        ref={toolbarRef}
        data-testid="editorial-image-toolbar"
        data-toolbar-placement={toolbarPlacement}
        data-toolbar-visible={showToolbar ? "true" : "false"}
        data-toolbar-compact={activeIsToolbarCompact ? "true" : "false"}
        data-toolbar-max-width={
          activeToolbarMaxWidthPx !== null && activeToolbarMaxWidthPx > 0
            ? String(activeToolbarMaxWidthPx)
            : undefined
        }
        contentEditable={false}
        style={{
          left: "50%",
          right: "auto",
          width: "max-content",
          maxWidth:
            activeToolbarMaxWidthPx !== null && activeToolbarMaxWidthPx > 0
              ? `${activeToolbarMaxWidthPx}px`
              : "calc(100vw - 2rem)",
          transform: `translateX(calc(-50% + ${Math.round(toolbarShiftX)}px))`,
        }}
        className={`absolute ${toolbarVerticalClass} left-1/2 z-30 flex flex-wrap items-center justify-center ${
          activeIsToolbarCompact
            ? "gap-0.5 px-1.5 py-1"
            : "gap-1 px-2.5 py-1.5"
        } bg-gray-900/95 text-white rounded-lg shadow-xl text-xs transition-opacity duration-150 ${
          showToolbar ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Drag Handle */}
        <span
          data-drag-handle=""
          data-testid="editorial-image-drag-handle"
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-white px-1 flex items-center shrink-0"
          title={isAr ? "اسحب لتحريك الصورة" : "Drag to move image"}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>

        <div className="w-px h-4 bg-gray-700 mx-0.5 shrink-0" />

        {/* Width Presets */}
        <div className="flex items-center gap-0.5 shrink-0">
          {ALLOWED_EDITORIAL_IMAGE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              data-testid={`editorial-image-width-${w}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSetWidth(w);
              }}
              className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                effectiveWidth === w
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
              title={isAr ? `عرض ${w}` : `Width ${w}`}
            >
              {w}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-gray-700 mx-0.5 shrink-0" />

        {/* Logical Alignment / Wrapping Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            data-testid="editorial-image-layout-float-start"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("float-start");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "float-start"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "محاذاة لبداية السطر (يمين في العربية / التفاف النص)"
                : "Float Start (Left in English / Wrap text)"
            }
          >
            {isRtl ? (
              <AlignRight className="w-3.5 h-3.5" />
            ) : (
              <AlignLeft className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-block-center"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("block-center");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "block-center"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "توسيط مستقل بدون التفاف"
                : "Center Block (No text wrap)"
            }
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-float-end"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("float-end");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "float-end"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "محاذاة لنهاية السطر (يسار في العربية / التفاف النص)"
                : "Float End (Right in English / Wrap text)"
            }
          >
            {isRtl ? (
              <AlignLeft className="w-3.5 h-3.5" />
            ) : (
              <AlignRight className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-block-full"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("block-full");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "block-full"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={isAr ? "عرض كامل للمقال" : "Full Article Width"}
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-4 bg-gray-700 mx-0.5 shrink-0" />

        {/* Delete Image Node */}
        <button
          type="button"
          data-testid="editorial-image-delete"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteNode();
          }}
          className="p-1 rounded text-red-400 hover:bg-red-950/60 hover:text-red-300 transition-colors cursor-pointer shrink-0"
          title={isAr ? "حذف الصورة من المقال" : "Remove image from article"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Image Element OR Private Asset Placeholder */}
      {resolvedPreviewUrl ? (
        <img
          data-testid="editorial-image-preview-img"
          src={resolvedPreviewUrl}
          alt={activeAltText}
          className="w-full h-auto rounded-t-md object-cover block select-none"
          draggable={false}
        />
      ) : (
        <div
          data-testid="editorial-image-private-placeholder"
          contentEditable={false}
          className="w-full min-h-[140px] rounded-t-md bg-slate-100 border-b border-slate-200 p-4 flex flex-col items-center justify-center text-center gap-2 select-none"
        >
          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
            {assetId ? (
              <ImageIcon className="w-4 h-4" />
            ) : (
              <ShieldAlert className="w-4 h-4" />
            )}
          </div>
          <p className="text-xs font-semibold text-slate-700">
            {isAr
              ? "معاينة الأصل الخاص غير متوفرة في الجلسة الحالية"
              : "Private editorial asset preview unavailable in current session"}
          </p>
          {activeAltText && (
            <p className="text-[11px] text-slate-600 max-w-md line-clamp-2">
              {activeAltText}
            </p>
          )}
          {assetId && (
            <span
              data-testid="editorial-image-placeholder-asset-id"
              className="px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 font-mono text-[10px]"
            >
              {assetId}
            </span>
          )}
        </div>
      )}

      {/* Caption Display & Inline Editing Affordance */}
      {(activeCaptionText || selected) && (
        <figcaption
          data-testid="editorial-image-figcaption"
          contentEditable={false}
          className="bg-gray-50 px-3 py-2 text-xs text-gray-600 border-t border-gray-200 rounded-b-md flex flex-col gap-1.5"
        >
          {activeCaptionText && (
            <span
              data-testid="editorial-image-caption-text"
              className="font-medium text-gray-700 leading-snug"
            >
              {activeCaptionText}
            </span>
          )}
          {selected && (
            <input
              type="text"
              data-testid="editorial-image-caption-input"
              value={isAr ? captionAr ?? "" : captionEn ?? ""}
              onChange={(e) => handleCaptionChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={
                isAr
                  ? "أضف أو عدّل التعليق التوضيحي للصورة (العربية)..."
                  : "Add or edit image caption (English)..."
              }
              className="w-full px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          )}
        </figcaption>
      )}
    </NodeViewWrapper>
  );
}

/* ==========================================
 * Canonical Tiptap Node Extension (V2)
 * ========================================== */

export const EditorialImageExtension = Node.create<EditorialImageExtensionOptions>({
  name: "editorialImage",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      previewUrlsByAssetId: undefined,
      getPreviewUrl: undefined,
    };
  },

  addAttributes() {
    return {
      assetId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-asset-id") || "",
        renderHTML: (attributes) =>
          attributes.assetId ? { "data-asset-id": attributes.assetId } : {},
      },
      altAr: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-alt-ar") || "",
        renderHTML: (attributes) =>
          attributes.altAr ? { "data-alt-ar": attributes.altAr } : {},
      },
      altEn: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-alt-en") || null,
        renderHTML: (attributes) =>
          typeof attributes.altEn === "string"
            ? { "data-alt-en": attributes.altEn }
            : {},
      },
      captionAr: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-caption-ar") || null,
        renderHTML: (attributes) =>
          typeof attributes.captionAr === "string"
            ? { "data-caption-ar": attributes.captionAr }
            : {},
      },
      captionEn: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-caption-en") || null,
        renderHTML: (attributes) =>
          typeof attributes.captionEn === "string"
            ? { "data-caption-en": attributes.captionEn }
            : {},
      },
      width: {
        default: "50%" as EditorialImageWidthV2,
        parseHTML: (element) => {
          const w = element.getAttribute("data-width");
          return w &&
            ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(w as EditorialImageWidthV2)
            ? w
            : "50%";
        },
        renderHTML: (attributes) => ({
          "data-width": attributes.width || "50%",
        }),
      },
      layout: {
        default: "float-start" as EditorialImageLayoutV2,
        parseHTML: (element) => {
          const l = element.getAttribute("data-layout");
          return l &&
            ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(
              l as EditorialImageLayoutV2
            )
            ? l
            : "float-start";
        },
        renderHTML: (attributes) => ({
          "data-layout": attributes.layout || "float-start",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-editorial-image]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width: EditorialImageWidthV2 =
      ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(node.attrs.width)
        ? node.attrs.width
        : "50%";
    const layout: EditorialImageLayoutV2 =
      ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(node.attrs.layout)
        ? node.attrs.layout
        : "float-start";
    const caption = node.attrs.captionAr || node.attrs.captionEn || "";

    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-editorial-image": "",
        "data-asset-id": node.attrs.assetId || "",
        "data-layout": layout,
        "data-width": width,
        class: `pop-editorial-figure pop-layout-${layout}`,
        style: `width: ${layout === "block-full" ? "100%" : width}; max-width: 100%;`,
      }),
      [
        "div",
        {
          "data-editorial-asset-placeholder": node.attrs.assetId || "",
          "aria-label": node.attrs.altAr || node.attrs.altEn || "",
        },
      ],
      ...(caption ? [["figcaption", {}, caption]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EditorialImageNodeView);
  },
});

/**
 * Fail-closed helper to insert a canonical V2 editorialImage node into a Tiptap Editor.
 * Throws a descriptive validation error if unknown, forbidden, or malformed attributes are supplied.
 */
export function insertCanonicalEditorialImageNode(
  editor: { chain: () => any },
  candidateAttrs: unknown
): EditorialImageNodeAttrsV2 {
  const validation = validateCanonicalEditorialImageAttrs(candidateAttrs);
  if (!validation.valid || !validation.attrs) {
    throw new Error(
      `INVALID_EDITORIAL_IMAGE_ATTRS: ${validation.errors.join("; ")}`
    );
  }

  editor
    .chain()
    .focus()
    .insertContent({
      type: "editorialImage",
      attrs: validation.attrs,
    })
    .run();

  return validation.attrs;
}

export default EditorialImageExtension;
