"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { useMathRenderEnvironment } from "@/features/rendering/adapters/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef } from "react";

import { pasteAsSingleBlockInlineContent } from "@/components/editor/text-flow/inline-block-paste";
import { InlineMathExtension, requestInlineMathEdit } from "@/components/tiptap/inline-math-extension";
import { useT } from "@/lib/i18n/react";
import type {
  InlineNode,
  MathFractionSizing,
} from "@/features/document";
import { createId } from "@/lib/id";
import {
  inlineNodesToTiptapDoc,
  tiptapDocToInlineNodes,
  type TiptapDoc,
} from "@/lib/tiptap-adapter";

const INSERT_INLINE_MATH_EVENT = "sigma-studio:insert-inline-math";

interface CommentRichTextEditorProps {
  value: InlineNode[];
  mathFractionSizing?: MathFractionSizing | null;
  placeholder?: string;
  onChange: (value: InlineNode[]) => void;
}

export function CommentRichTextEditor({
  value,
  mathFractionSizing,
  placeholder,
  onChange,
}: CommentRichTextEditorProps) {
  const t = useT("editor");
  // 既定値を引数に書くと翻訳前の文言が焼き付くので、本文側で解決する。
  const resolvedPlaceholder = placeholder ?? t("comment.placeholder");
  const valueRef = useRef(value);
  const previousSerializedRef = useRef(JSON.stringify(value));
  const initialContent = useMemo(() => inlineNodesToTiptapDoc(value), [value]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const mathEnvironment = useMathRenderEnvironment(mathFractionSizing);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        undoRedo: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
      // prop の組版設定と文書コンテキストを 1 つの環境に畳んでから渡す
      // (別々に読むと、片方だけ差し替わったときに静的と編集中が食い違う)。
      InlineMathExtension.configure({ mathEnvironment }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "comment-rich-text-editor",
      },
      // 保存できるのは 1 ブロックぶんの inline だけ。段落のまま貼らせると画面には出るのに
      // 保存で 2 行目以降が消えるので、貼るものを畳んでこのブロックの中へ入れる。
      handlePaste: (view, event, slice) => pasteAsSingleBlockInlineContent(view, event, slice),
    },
    onUpdate: ({ editor: activeEditor }) => {
      const nextValue = tiptapDocToInlineNodes(activeEditor.getJSON() as TiptapDoc);
      previousSerializedRef.current = JSON.stringify(nextValue);
      onChange(nextValue);
    },
    // プレースホルダが変わったらエディタを作り直す (表示言語を切り替えたときだけ)。
  }, [resolvedPlaceholder]);

  const serializedValue = JSON.stringify(value);
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) {
      return;
    }
    if (previousSerializedRef.current === serializedValue) {
      return;
    }

    previousSerializedRef.current = serializedValue;
    editor.commands.setContent(inlineNodesToTiptapDoc(valueRef.current), { emitUpdate: false });
  }, [editor, serializedValue]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const insertInlineMath = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (detail?.target !== "comment") {
        return;
      }

      const tex = typeof detail.tex === "string" ? detail.tex : "";
      const shouldEdit = detail.edit === true;
      if (!tex && !shouldEdit) {
        return;
      }

      const id = createId("m_comment");
      editor
        .chain()
        .focus()
        .insertMathInline({ id, tex })
        .run();

      if (shouldEdit) {
        requestInlineMathEdit(id);
      }
    };

    window.addEventListener(INSERT_INLINE_MATH_EVENT, insertInlineMath);
    return () => window.removeEventListener(INSERT_INLINE_MATH_EVENT, insertInlineMath);
  }, [editor]);

  return (
    <div className="comment-rich-text-shell">
      <EditorContent editor={editor} />
    </div>
  );
}
