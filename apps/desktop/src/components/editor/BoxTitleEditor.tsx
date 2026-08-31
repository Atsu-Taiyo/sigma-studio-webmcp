"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Sigma } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { pasteAsSingleBlockInlineContent } from "@/components/editor/text-flow/inline-block-paste";
import { InlineMathExtension, requestInlineMathEdit } from "@/components/tiptap/inline-math-extension";
import { IconButton } from "@/components/ui/Button";
import type { InlineNode, MathFractionSizing } from "@/features/document";
import { useMathRenderEnvironment } from "@/features/rendering/adapters/react";
import { createId } from "@/lib/id";
import { useT } from "@/lib/i18n/react";
import {
  inlineNodesToTiptapDoc,
  tiptapDocToInlineNodes,
  type TiptapDoc,
} from "@/lib/tiptap-adapter";

import styles from "./BoxTitleEditor.module.css";

interface BoxTitleEditorProps {
  value: InlineNode[];
  mathFractionSizing?: MathFractionSizing | null;
  autoFocus?: boolean;
  onChange: (value: InlineNode[]) => void;
}

/**
 * 箱のタイトルだけを編集する 1 行のリッチ入力。
 *
 * 本文と同じ数式ノードをそのまま持てるように、本文編集と同一の `InlineMathExtension` を積む。
 * 数式の挿入だけはツールバーの Σ に頼れない (ツールバーの挿入先は「本文かオーバーレイか
 * コメントか」で決まり、モーダルの中は本文扱いになって裏の本文へ数式が落ちる) ので、
 * この入力自身が挿入操作を持つ。
 */
export function BoxTitleEditor({
  value,
  mathFractionSizing,
  autoFocus = false,
  onChange,
}: BoxTitleEditorProps) {
  const t = useT("settings");
  const valueRef = useRef(value);
  const previousSerializedRef = useRef(JSON.stringify(value));
  const initialContent = useMemo(() => inlineNodesToTiptapDoc(value), [value]);
  const placeholder = t("box.titlePlaceholder");

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const mathEnvironment = useMathRenderEnvironment(mathFractionSizing);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      InlineMathExtension.configure({ mathEnvironment }),
    ],
    content: initialContent,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: styles.field,
        "aria-label": t("box.titleSection"),
      },
      // タイトルは 1 ブロックぶんの inline しか持てない。改行や複数段落を作らせると
      // 画面には出るのに保存で 2 行目以降が消えるので、入り口で畳んでおく。
      handleKeyDown: (_view, event) => event.key === "Enter" && !event.isComposing,
      handlePaste: (view, event, slice) => pasteAsSingleBlockInlineContent(view, event, slice),
    },
    onUpdate: ({ editor: activeEditor }) => {
      const nextValue = tiptapDocToInlineNodes(activeEditor.getJSON() as TiptapDoc);
      previousSerializedRef.current = JSON.stringify(nextValue);
      onChange(nextValue);
    },
    // プレースホルダが変わったらエディタを作り直す (表示言語を切り替えたときだけ)。
  }, [placeholder]);

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

  const insertMath = () => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const id = createId("m_box_title");
    editor.chain().focus().insertMathInline({ id, tex: "" }).run();
    requestInlineMathEdit(id);
  };

  return (
    <div className={styles.shell}>
      <div className={styles.input}>
        <EditorContent editor={editor} />
      </div>
      <IconButton
        label={t("box.titleInsertMath")}
        tone="ghost"
        size="sm"
        onMouseDown={(event) => event.preventDefault()}
        onClick={insertMath}
      >
        <Sigma size={16} />
      </IconButton>
    </div>
  );
}
