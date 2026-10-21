import React from "react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { Extension, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Trash2, GripVertical } from "lucide-react";

export const SandboxDirectionExtension = Extension.create({
  name: "direction",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "blockquote"],
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => element.getAttribute("dir") || null,
            renderHTML: (attributes) => {
              if (!attributes.dir) return {};
              return { dir: attributes.dir };
            },
          },
        },
      },
    ];
  },
});

export interface SandboxImageAttributes {
  src: string;
  alt?: string;
  title?: string;
  caption?: string;
  credit?: string;
  width?: string;
  alignment?: string;
  layout?: "float-start" | "float-end" | "block-center" | "block-full";
}

export interface SandboxLocaleContextValue {
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}

export const SandboxLocaleContext = React.createContext<SandboxLocaleContextValue>({
  lang: "ar",
  dir: "rtl",
});

/**
 * Interactive React NodeView for editorial images inside Tiptap editor.
 * Applies CSS float, width, and clear properties directly to NodeViewWrapper
 * so sibling paragraph elements in ProseMirror wrap around the floated image.
 */
export function SandboxImageNodeView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const { src, alt, caption, credit, width = "50%", layout, alignment } = node.attrs;

  const localeContext = React.useContext(SandboxLocaleContext);
  const isRtl = localeContext.dir === "rtl";

  const figureRef = React.useRef<HTMLElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const [toolbarShift, setToolbarShift] = React.useState<number | null>(null);

  let effectiveLayout: "float-start" | "float-end" | "block-center" | "block-full" = layout;
  if (!effectiveLayout || !["float-start", "float-end", "block-center", "block-full"].includes(effectiveLayout)) {
    if (alignment === "center") effectiveLayout = "block-center";
    else if (alignment === "end" || alignment === "left") effectiveLayout = "float-end";
    else if (alignment === "full") effectiveLayout = "block-full";
    else effectiveLayout = "float-start";
  }

  React.useLayoutEffect(() => {
    if (!selected) {
      setToolbarShift(null);
      return;
    }

    const adjustToolbarPosition = () => {
      if (!figureRef.current || !toolbarRef.current || !editor?.view?.dom) return;

      const editorDom = editor.view.dom;
      const editorRect = editorDom.getBoundingClientRect();
      const figureRect = figureRef.current.getBoundingClientRect();
      const toolbarRect = toolbarRef.current.getBoundingClientRect();

      if (!figureRect.width || !toolbarRect.width || !editorRect.width) return;

      const minLeftBoundary = editorRect.left + 8;
      const maxRightBoundary = editorRect.right - 8;

      const idealLeftOffset = figureRect.width / 2 - toolbarRect.width / 2;
      const idealToolbarLeft = figureRect.left + idealLeftOffset;
      const idealToolbarRight = idealToolbarLeft + toolbarRect.width;

      let shift = 0;
      if (idealToolbarRight > maxRightBoundary) {
        shift = maxRightBoundary - idealToolbarRight;
      } else if (idealToolbarLeft < minLeftBoundary) {
        shift = minLeftBoundary - idealToolbarLeft;
      }

      setToolbarShift(idealLeftOffset + shift);
    };

    adjustToolbarPosition();

    const resizeObserver = new ResizeObserver(() => {
      adjustToolbarPosition();
    });

    if (figureRef.current) resizeObserver.observe(figureRef.current);
    if (editor?.view?.dom) resizeObserver.observe(editor.view.dom);

    window.addEventListener("resize", adjustToolbarPosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", adjustToolbarPosition);
    };
  }, [selected, width, effectiveLayout, isRtl, editor, localeContext.dir, localeContext.lang]);

  let floatStyle: React.CSSProperties = {};
  let layoutClass = "";

  if (effectiveLayout === "float-start") {
    layoutClass = "pop-layout-float-start";
    if (width === "100%") {
      floatStyle = { float: "none", display: "block", clear: "both", width: "100%", maxWidth: "100%", marginTop: "0.5rem", marginBottom: "0.75rem" };
    } else {
      floatStyle = isRtl
        ? { float: "right", marginLeft: "1.25rem", marginRight: "0", marginBottom: "0.75rem", marginTop: "0.25rem", width: width || "50%", maxWidth: "100%" }
        : { float: "left", marginRight: "1.25rem", marginLeft: "0", marginBottom: "0.75rem", marginTop: "0.25rem", width: width || "50%", maxWidth: "100%" };
    }
  } else if (effectiveLayout === "float-end") {
    layoutClass = "pop-layout-float-end";
    if (width === "100%") {
      floatStyle = { float: "none", display: "block", clear: "both", width: "100%", maxWidth: "100%", marginTop: "0.5rem", marginBottom: "0.75rem" };
    } else {
      floatStyle = isRtl
        ? { float: "left", marginRight: "1.25rem", marginLeft: "0", marginBottom: "0.75rem", marginTop: "0.25rem", width: width || "50%", maxWidth: "100%" }
        : { float: "right", marginLeft: "1.25rem", marginRight: "0", marginBottom: "0.75rem", marginTop: "0.25rem", width: width || "50%", maxWidth: "100%" };
    }
  } else if (effectiveLayout === "block-center") {
    layoutClass = "pop-layout-block-center";
    floatStyle = { float: "none", display: "block", clear: "both", marginLeft: "auto", marginRight: "auto", marginTop: "0.5rem", marginBottom: "0.75rem", width: width || "50%", maxWidth: "100%" };
  } else if (effectiveLayout === "block-full") {
    layoutClass = "pop-layout-block-full";
    floatStyle = { float: "none", display: "block", clear: "both", width: "100%", maxWidth: "100%", marginLeft: "0", marginRight: "0", marginTop: "0.5rem", marginBottom: "0.75rem" };
  }

  const toolbarStyle: React.CSSProperties = toolbarShift !== null
    ? { left: `${toolbarShift}px`, transform: "none" }
    : { left: "50%", transform: "translateX(-50%)" };

  return React.createElement(
    NodeViewWrapper,
    {
      as: "figure",
      ref: figureRef,
      className: `editorial-image-node-wrapper pop-editorial-figure ${layoutClass} group relative transition-all rounded-lg border-2 my-2 ${
        selected ? "border-emerald-600 ring-2 ring-emerald-200 shadow-md" : "border-transparent hover:border-gray-300/80"
      }`,
      style: floatStyle,
      "data-drag-handle": "",
      "data-layout": effectiveLayout,
    },
    /* Contextual Overlay Controls Toolbar (Boundary-clamped & flex wrapping) */
    React.createElement(
      "div",
      {
        ref: toolbarRef,
        style: toolbarStyle,
        className: `absolute bottom-full mb-2 z-30 flex flex-wrap sm:flex-nowrap items-center justify-center gap-1 bg-gray-900/95 text-white p-1.5 rounded-lg shadow-xl text-xs font-medium transition-all max-w-[calc(100vw-2rem)] w-max ${
          selected
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto"
        }`,
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
      /* Drag handle for move-without-copy */
      React.createElement(
        "div",
        {
          className: "p-1 rounded cursor-grab active:cursor-grabbing hover:bg-gray-700 text-gray-400 hover:text-white transition-colors shrink-0",
          "data-drag-handle": "",
          title: isRtl ? "سحب لنقل موضع الصورة داخل المقال (Move Image)" : "Drag to move image within article",
        },
        React.createElement(GripVertical, { className: "w-3.5 h-3.5" })
      ),
      React.createElement("div", { className: "w-px h-4 bg-gray-700 mx-0.5 shrink-0 hidden sm:block" }),

      /* Width Group */
      React.createElement(
        "div",
        { className: "flex items-center gap-1 shrink-0" },
        React.createElement("span", { className: "text-[10px] text-gray-400 font-mono px-0.5" }, isRtl ? "العرض:" : "Width:"),
        ["25%", "50%", "75%", "100%"].map((w) =>
          React.createElement(
            "button",
            {
              key: w,
              type: "button",
              onClick: (e: React.MouseEvent) => {
                e.preventDefault();
                updateAttributes({ width: w });
              },
              className: `px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                width === w ? "bg-emerald-600 text-white font-bold" : "hover:bg-gray-700 text-gray-300"
              }`,
              title: isRtl ? `تغيير العرض إلى ${w}` : `Resize width to ${w}`,
            },
            w
          )
        )
      ),
      React.createElement("div", { className: "w-px h-4 bg-gray-700 mx-0.5 shrink-0 hidden sm:block" }),

      /* Layout Group */
      React.createElement(
        "div",
        { className: "flex items-center gap-1 shrink-0" },
        React.createElement("span", { className: "text-[10px] text-gray-400 font-mono px-0.5" }, isRtl ? "التنسيق:" : "Layout:"),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              updateAttributes({ layout: "float-start", alignment: "start" });
            },
            className: `px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              effectiveLayout === "float-start" ? "bg-emerald-600 text-white font-bold" : "hover:bg-gray-700 text-gray-300"
            }`,
            title: isRtl ? "التفاف بداية (يمين في العربية)" : "Float Start (Left in LTR)",
          },
          isRtl ? "بداية" : "Start"
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              updateAttributes({ layout: "float-end", alignment: "end" });
            },
            className: `px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              effectiveLayout === "float-end" ? "bg-emerald-600 text-white font-bold" : "hover:bg-gray-700 text-gray-300"
            }`,
            title: isRtl ? "التفاف نهاية (يسار في العربية)" : "Float End (Right in LTR)",
          },
          isRtl ? "نهاية" : "End"
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              updateAttributes({ layout: "block-center", alignment: "center" });
            },
            className: `px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              effectiveLayout === "block-center" ? "bg-emerald-600 text-white font-bold" : "hover:bg-gray-700 text-gray-300"
            }`,
            title: isRtl ? "وسط (بدون التفاف)" : "Center (No wrap)",
          },
          isRtl ? "وسط" : "Center"
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              updateAttributes({ layout: "block-full", alignment: "full" });
            },
            className: `px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              effectiveLayout === "block-full" ? "bg-emerald-600 text-white font-bold" : "hover:bg-gray-700 text-gray-300"
            }`,
            title: isRtl ? "عرض كامل" : "Full Width",
          },
          isRtl ? "كامل" : "Full"
        )
      ),
      React.createElement("div", { className: "w-px h-4 bg-gray-700 mx-0.5 shrink-0 hidden sm:block" }),

      /* Delete Image Action */
      React.createElement(
        "button",
        {
          type: "button",
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            deleteNode();
          },
          className: "p-1 rounded hover:bg-red-600 text-red-300 hover:text-white transition-colors cursor-pointer shrink-0",
          title: isRtl ? "حذف الصورة من المقال (Delete Image)" : "Delete Image",
        },
        React.createElement(Trash2, { className: "w-3.5 h-3.5" })
      )
    ),
    React.createElement("img", {
      src: src,
      alt: alt || "",
      draggable: false,
      className: "pop-editorial-img rounded-md shadow-xs border border-gray-200 w-full object-cover block select-none pointer-events-none",
    }),
    (caption || credit)
      ? React.createElement(
          "figcaption",
          { className: "pop-editorial-caption text-[11px] text-gray-500 mt-1.5 px-1 flex flex-wrap justify-between items-center gap-1.5 select-none" },
          caption ? React.createElement("span", { className: "font-medium text-gray-700" }, caption) : null,
          credit ? React.createElement("span", { className: "text-gray-400 italic text-[10px]" }, credit) : null
        )
      : null
  );
}

export const SandboxEditorialImageExtension = Image.extend({
  name: "editorialImage",
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: "",
      },
      title: {
        default: "",
      },
      caption: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-caption") || "",
        renderHTML: (attributes) => {
          if (!attributes.caption) return {};
          return { "data-caption": attributes.caption };
        },
      },
      credit: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-credit") || "",
        renderHTML: (attributes) => {
          if (!attributes.credit) return {};
          return { "data-credit": attributes.credit };
        },
      },
      width: {
        default: "50%",
        parseHTML: (element) => element.getAttribute("data-width") || "50%",
        renderHTML: (attributes) => {
          return { "data-width": attributes.width || "50%" };
        },
      },
      alignment: {
        default: "start",
        parseHTML: (element) => element.getAttribute("data-alignment") || "start",
        renderHTML: (attributes) => {
          return { "data-alignment": attributes.alignment || "start" };
        },
      },
      layout: {
        default: "float-start",
        parseHTML: (element) => {
          const l = element.getAttribute("data-layout");
          if (l && ["float-start", "float-end", "block-center", "block-full"].includes(l)) {
            return l;
          }
          const a = element.getAttribute("data-alignment");
          if (a === "center") return "block-center";
          if (a === "end" || a === "left") return "float-end";
          if (a === "full") return "block-full";
          return "float-start";
        },
        renderHTML: (attributes) => {
          return { "data-layout": attributes.layout || "float-start" };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(SandboxImageNodeView);
  },

  renderHTML({ HTMLAttributes }) {
    const { caption, credit, layout = "float-start", width = "50%" } = HTMLAttributes;

    const figureClasses = [
      "pop-editorial-figure",
      `pop-layout-${layout}`,
      "my-3",
      "transition-all",
    ].join(" ");

    return [
      "figure",
      mergeAttributes({
        class: figureClasses,
        "data-layout": layout,
        "data-width": width,
        "data-caption": caption || "",
        "data-credit": credit || "",
        style: `width: ${width}; max-width: 100%;`,
      }),
      [
        "img",
        mergeAttributes(HTMLAttributes, {
          class: "pop-editorial-img rounded-md border border-gray-200 w-full object-cover",
        }),
      ],
      ...(caption || credit
        ? [
            [
              "figcaption",
              {
                class:
                  "pop-editorial-caption text-xs text-gray-500 mt-1 px-1 flex flex-wrap justify-between items-center gap-2",
              },
              ...(caption ? [["span", { class: "font-medium" }, caption]] : []),
              ...(credit ? [["span", { class: "text-gray-400 italic text-[11px]" }, credit]] : []),
            ],
          ]
        : []),
    ];
  },
});

export function getSandboxTiptapExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      heading: {
        levels: [2, 3, 4],
      },
      horizontalRule: {},
      blockquote: {},
      bulletList: {},
      orderedList: {},
      listItem: {},
      paragraph: {},
      hardBreak: {},
      bold: {},
      italic: {},
      strike: {},
      underline: false,
      link: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: false,
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: "_blank",
      },
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["right", "left", "center", "justify"],
    }),
    SandboxDirectionExtension,
    SandboxEditorialImageExtension,
  ];
}

