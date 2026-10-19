import { useEditor, EditorContent } from "@tiptap/react";
import { getE1CTiptapExtensions } from "./tiptapExtensions";
import {
  tiptapJsonToRichDocument,
  richDocumentToTiptapJson,
} from "../../../services/richNewsTiptapAdapter";
import type { RichNewsDocumentWrapper } from "../../../types/richNewsDocument";
import { useEffect } from "react";
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link, 
  List, ListOrdered, Quote, Heading2, Heading3, Heading4,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Undo, Redo 
} from "lucide-react";

interface RichTextEditorProps {
  value: RichNewsDocumentWrapper;
  onChange: (value: RichNewsDocumentWrapper) => void;
  readOnly?: boolean;
}

export function RichTextEditor({ value, onChange, readOnly = false }: RichTextEditorProps) {
  const extensions = getE1CTiptapExtensions();

  const editor = useEditor({
    extensions,
    content: richDocumentToTiptapJson(value),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(tiptapJsonToRichDocument(editor.getJSON() as any));
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    
    try {
      const currentJson = editor.getJSON();
      const nextJson = richDocumentToTiptapJson(value);
      
      // Use stringification for deep content equality check to avoid infinite loops 
      // or redundant setContent calls caused by reference inequality.
      if (JSON.stringify(currentJson) !== JSON.stringify(nextJson)) {
        editor.commands.setContent(nextJson, { emitUpdate: false });
      }
    } catch (err) {
      console.error("RichTextEditor: Failed to sync external value", err);
    }
  }, [value, editor]);


  if (!editor) return null;

  const ToolbarButton = ({ onClick, icon: Icon, isActive, title }: any) => (
    <button
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded-md transition-colors ${isActive ? 'bg-emerald-100 text-emerald-700' : 'text-gray-600 hover:bg-gray-100'}`}
      title={title}
      disabled={readOnly}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col min-h-[300px]">
      {!readOnly && (
        <div className="border-b border-gray-200 p-2 flex flex-wrap gap-1 bg-gray-50">
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} isActive={editor.isActive('bold')} title="Bold" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} isActive={editor.isActive('italic')} title="Italic" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UnderlineIcon} isActive={editor.isActive('underline')} title="Underline" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} icon={Strikethrough} isActive={editor.isActive('strike')} title="Strike" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleLink({ href: '' }).run()} icon={Link} isActive={editor.isActive('link')} title="Link" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} isActive={editor.isActive('bulletList')} title="Bullet List" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} isActive={editor.isActive('orderedList')} title="Numbered List" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} isActive={editor.isActive('blockquote')} title="Blockquote" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} isActive={editor.isActive('heading', { level: 2 })} title="Heading 2" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={Heading3} isActive={editor.isActive('heading', { level: 3 })} title="Heading 3" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} icon={Heading4} isActive={editor.isActive('heading', { level: 4 })} title="Heading 4" />
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} icon={AlignLeft} isActive={editor.isActive({ textAlign: 'left' })} title="Align Left" />
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} icon={AlignCenter} isActive={editor.isActive({ textAlign: 'center' })} title="Align Center" />
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} icon={AlignRight} isActive={editor.isActive({ textAlign: 'right' })} title="Align Right" />
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} icon={AlignJustify} isActive={editor.isActive({ textAlign: 'justify' })} title="Align Justify" />
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} icon={Undo} title="Undo" />
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} icon={Redo} title="Redo" />
        </div>
      )}
      <div className="p-4 flex-1 prose max-w-none">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
