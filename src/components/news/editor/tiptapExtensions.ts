import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { Extension } from "@tiptap/core";
import {
  EditorialImageExtension,
  type EditorialImageExtensionOptions,
} from "./editorialImageExtension";

export const DirectionExtension = Extension.create({
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

export function getE1CTiptapExtensions(
  editorialImageOptions?: EditorialImageExtensionOptions
) {
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
    DirectionExtension,
    editorialImageOptions
      ? EditorialImageExtension.configure(editorialImageOptions)
      : EditorialImageExtension,
  ];
}

