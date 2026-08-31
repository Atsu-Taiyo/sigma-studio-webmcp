import { Check, HelpCircle, Loader2, PenLine, PlusCircle, Trash2, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { MaterialEditSurface } from "@/components/editor/materials/MaterialEditSurface";
import { isOfficialMaterial } from "@/lib/official-materials";
import type { MaterialContent, MaterialItem } from "@/types/material";
import { MATERIAL_EDITOR_FORMAT_TARGET } from "./constants";
import { useT } from "@/lib/i18n/react";

export interface MaterialMetadataDraft {
  name: string;
  description: string;
  useCases: string;
  avoidWhen: string;
  aliases: string;
  visualConcepts: string;
}

export function createEmptyMaterialMetadataDraft(): MaterialMetadataDraft {
  return {
    name: "",
    description: "",
    useCases: "",
    avoidWhen: "",
    aliases: "",
    visualConcepts: "",
  };
}

export function materialToMetadataDraft(material: MaterialItem): MaterialMetadataDraft {
  return {
    name: material.name,
    description: material.description ?? "",
    useCases: (material.usage?.useCases ?? []).join("\n"),
    avoidWhen: (material.usage?.avoidWhen ?? []).join("\n"),
    aliases: (material.usage?.aliases ?? []).join(", "),
    visualConcepts: (material.visualConcepts ?? []).join(", "),
  };
}

export function materialMetadataDraftToInput(draft: MaterialMetadataDraft): Partial<MaterialItem> {
  const useCases = splitMaterialListInput(draft.useCases);
  const avoidWhen = splitMaterialListInput(draft.avoidWhen);
  const aliases = splitMaterialListInput(draft.aliases);
  return {
    description: draft.description,
    usage: {
      ...(useCases.length > 0 ? { useCases } : {}),
      ...(avoidWhen.length > 0 ? { avoidWhen } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    },
    visualConcepts: splitMaterialListInput(draft.visualConcepts),
  };
}

function splitMaterialListInput(input: string): string[] {
  return [...new Set(input
    .split(/[\n,、]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

/**
 * 素材の検索語 (`visualConcepts`)。
 *
 * **これは表示文言ではなく、素材に保存されて検索の照合に使われる語彙。**
 * `materialMatchesQuery` / `materialMatchesConcepts` (lib/materials.ts) が、
 * 利用者や AI の書いた語をこの集合へ突き合わせる。UI 言語で訳して 1 言語に
 * すると、**もう一方の言語で保存された素材が永久に引けなくなる** (しかも
 * 保存済みデータなので後から直せない)。日英を両方積むのが正しい。
 *
 * 元コードが「箱」と "box" を並べていたのはそのため。他の語にも英語を揃えた。
 *
 * **この変更より前に保存された素材は和語しか持たない。** 英語で概念検索しても
 * 古い素材は出てこないが、保存済みデータなので遡って直せない。
 */
export function suggestVisualConceptsForMaterialContent(content: MaterialContent): string[] {
  const concepts = new Set<string>();
  /* eslint-disable no-restricted-syntax -- 表示文言ではなく検索の照合語彙 (上の注記参照)。 */
  for (const block of content.blocks) {
    if (block.type === "boxBlock") {
      concepts.add("箱");
      concepts.add("box");
    }
    if (block.type === "problem") {
      concepts.add("問題");
      concepts.add("problem");
    }
  }
  for (const shape of content.overlaySnapshot.shapes) {
    // shape.type 自体も機械値として積む ("arrow" / "tableShape" …)。
    concepts.add(shape.type);
    // arrow / line / image は `shape.type` がそのまま英語なので、和語だけ足せばよい。
    // tableShape / graph2dShape は英単語ではないので英語も明示する。
    if (shape.type === "arrow") concepts.add("矢印");
    if (shape.type === "line") concepts.add("線");
    if (shape.type === "tableShape") { concepts.add("表"); concepts.add("table"); }
    if (shape.type === "graph2dShape") { concepts.add("グラフ"); concepts.add("graph"); }
    if (shape.type === "graph3dShape") { concepts.add("3D教材"); concepts.add("3D material"); }
    if (shape.type === "image") concepts.add("画像");
  }
  /* eslint-enable no-restricted-syntax */
  return [...concepts];
}

export function cloneMaterialContentForEditing(content: MaterialContent): MaterialContent {
  return JSON.parse(JSON.stringify(content)) as MaterialContent;
}

interface MaterialMetadataDraftFieldsProps {
  value: MaterialMetadataDraft;
  onChange: (value: MaterialMetadataDraft) => void;
  nameLabel?: string;
  hideName?: boolean;
  compact?: boolean;
  autoFocusName?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
}

interface MaterialEditDialogProps {
  material: MaterialItem;
  content: MaterialContent;
  draft: MaterialMetadataDraft;
  saving: boolean;
  onContentChange: (content: MaterialContent) => void;
  onDraftChange: (value: MaterialMetadataDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onOpenInfo: () => void;
}

export function MaterialEditDialog({
  material,
  content,
  draft,
  saving,
  onContentChange,
  onDraftChange,
  onSave,
  onClose,
  onOpenInfo,
}: MaterialEditDialogProps) {
  const t = useT("workspace");

  return (
    <div className="material-edit-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={onClose}>
      <section
        className="material-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("asset.edit")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="material-add-header">
          <div>
            <h2>{t("asset.edit")}</h2>
            <p>{t("asset.editDescription")}</p>
          </div>
          <div className="material-dialog-header-actions">
            <button type="button" className="icon-button" title={t("asset.aiInfo")} aria-label={t("asset.aiInfo")} onClick={onOpenInfo}>
              <HelpCircle size={16} />
            </button>
            <button type="button" className="icon-button" title={t("action.close")} aria-label={t("action.close")} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <MaterialEditSurface
          content={content}
          title={draft.name || material.name}
          saving={saving}
          formatTarget={MATERIAL_EDITOR_FORMAT_TARGET}
          onContentChange={onContentChange}
          metadataPanel={(
            <section className="material-edit-side-section">
              <div className="material-edit-side-title">{t("asset.infoHeading")}</div>
              <MaterialMetadataDraftFields
                value={draft}
                onChange={onDraftChange}
                nameLabel={t("asset.nameLabel")}
                compact
                autoFocusName
                onSubmit={onSave}
                onCancel={onClose}
              />
            </section>
          )}
        />
        <footer className="material-add-actions">
          <button type="button" className="button primary" disabled={saving || !draft.name.trim()} onClick={onSave}>
            {saving ? <Loader2 className="save-state-spinner" size={14} /> : <Check size={14} />}
            {t("action.save")}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface InfoDialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function InfoDialog({ title, children, onClose }: InfoDialogProps) {
  const t = useT("workspace");
  return (
    <div className="info-dialog-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={onClose}>
      <section
        className="info-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="info-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" title={t("action.close")} aria-label={t("action.close")} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="info-dialog-body">
          {children}
        </div>
      </section>
    </div>
  );
}

export function MaterialMetadataDraftFields({
  value,
  onChange,
  nameLabel: nameLabelProp,
  hideName = false,
  compact = false,
  autoFocusName = false,
  onSubmit,
  onCancel,
}: MaterialMetadataDraftFieldsProps) {
  const t = useT("workspace");
  // 既定値を引数に書くと、本体で宣言した `t` より前に評価されて TDZ で落ちる。
  const nameLabel = nameLabelProp ?? t("asset.nameLabel");

  const setField = (field: keyof MaterialMetadataDraft, nextValue: string) => {
    onChange({ ...value, [field]: nextValue });
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSubmit?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  };

  return (
    <div className={`material-metadata-fields${compact ? " compact" : ""}`}>
      {!hideName && (
        <label>
          <span>{nameLabel}</span>
          <input
            type="text"
            value={value.name}
            aria-label={nameLabel}
            autoFocus={autoFocusName}
            onChange={(event) => setField("name", event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
      )}
      <label>
        <span>{t("asset.useCasesShort")}</span>
        <textarea
          value={value.description}
          aria-label={t("asset.useCases")}
          rows={compact ? 2 : 3}
          onChange={(event) => setField("description", event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <label>
        <span>{t("asset.useCasesExampleShort")}</span>
        <textarea
          value={value.useCases}
          aria-label={t("asset.useCasesExample")}
          rows={compact ? 2 : 3}
          placeholder={t("asset.useCasesPlaceholder")}
          onChange={(event) => setField("useCases", event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <label>
        <span>{t("asset.imageTagsShort")}</span>
        <input
          type="text"
          value={value.visualConcepts}
          aria-label={t("asset.imageTags")}
          placeholder={t("asset.imageTagsPlaceholder")}
          onChange={(event) => setField("visualConcepts", event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <label>
        <span>{t("asset.aliasesShort")}</span>
        <input
          type="text"
          value={value.aliases}
          aria-label={t("asset.aliases")}
          placeholder={t("asset.aliasesPlaceholder")}
          onChange={(event) => setField("aliases", event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      {!compact && (
        <label>
          <span>{t("asset.avoidWhenShort")}</span>
          <textarea
            value={value.avoidWhen}
            aria-label={t("asset.avoidWhen")}
            rows={2}
            onChange={(event) => setField("avoidWhen", event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
      )}
    </div>
  );
}

interface MaterialActionMenuProps {
  material: MaterialItem;
  x: number;
  y: number;
  onInsert: (material: MaterialItem) => void;
  onRename: (material: MaterialItem) => void;
  onDelete: (material: MaterialItem) => void | Promise<void>;
}

export function MaterialActionMenu({ material, x, y, onInsert, onRename, onDelete }: MaterialActionMenuProps) {
  const t = useT("workspace");

  const readOnly = isOfficialMaterial(material);
  return (
    <div
      className="material-action-menu"
      role="menu"
      aria-label={t("action.itemMenu", { replace: { name: material.name } })}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onInsert(material)}
      >
        <PlusCircle size={15} />
        <span>{t("action.insert")}</span>
      </button>
      {!readOnly && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onRename(material)}
          >
            <PenLine size={15} />
            <span>{t("action.edit")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => void onDelete(material)}
          >
            <Trash2 size={15} />
            <span>{t("action.deleteShort")}</span>
          </button>
        </>
      )}
    </div>
  );
}
