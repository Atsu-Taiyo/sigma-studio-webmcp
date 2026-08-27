"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { Grid, Inline, Stack } from "@/components/ui/layout";
import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui/Modal";
import type { BoxBlockNode, BoxFrameSpec, BoxSpacingPx } from "@/features/document";
import {
  resolveBoxStyles,
  boxFrameClassName,
  boxFrameDecorationAttributes,
  boxFrameStyleVars,
  resolveBoxFrame,
} from "@/lib/box-blocks";
import styles from "./BoxSettingsDialog.module.css";
import { useT } from "@/lib/i18n/react";

type BoxSettingsBlock = Pick<BoxBlockNode, "id" | "styleId" | "frame">;

interface BoxSettingsDialogProps {
  boxBlock: BoxSettingsBlock;
  onStyleChange: (styleId: string) => void;
  onFrameChange: (patch: Partial<BoxFrameSpec>) => void;
  onClose: () => void;
}

type PaddingMode = "all" | "sides";

const DEFAULT_PADDING: BoxSpacingPx = {
  top: 12,
  right: 14,
  bottom: 12,
  left: 14,
};

/**
 * boxBlockの見た目に関する設定だけを集約する。
 * タイトル本文はエディタ内で直接編集し、このダイアログでは扱わない。
 */
export function BoxSettingsDialog({
  boxBlock,
  onStyleChange,
  onFrameChange,
  onClose,
}: BoxSettingsDialogProps) {
  const t = useT("settings");
  // 箱スタイルの説明は本文編集面の語彙なので `editor` namespace が持つ。
  const tEditor = useT("editor");
  const resolvedFrame = resolveBoxFrame(boxBlock);
  const padding = resolvedFrame.paddingPx ?? DEFAULT_PADDING;
  const [paddingMode, setPaddingMode] = useState<PaddingMode>(() => (
    hasUniformPadding(padding) ? "all" : "sides"
  ));
  const uniformPadding = hasUniformPadding(padding) ? padding.top : "";
  const borderColor = resolvedFrame.borderColor ?? "#000000";

  const patchPadding = (side: keyof BoxSpacingPx, value: number) => {
    onFrameChange({
      paddingPx: {
        ...padding,
        [side]: value,
      },
    });
  };

  return (
    <ModalFrame
      open
      onDismiss={onClose}
      size="lg"
      layer="nested"
      ariaLabel={t("box.title")}
      surfaceClassName={styles.dialog}
    >
      <ModalHeader
        title={t("box.title")}
        description={t("box.description")}
        onClose={onClose}
      />
      <ModalBody padding="xl">
        <Stack gap="xl">
          <Stack as="section" gap="md" aria-labelledby="box-settings-style-heading">
            <SectionHeading id="box-settings-style-heading" title={t("box.style")} />
            <Grid columns={3} gap="sm" className={styles.styleGrid}>
              {resolveBoxStyles(tEditor).map((style) => {
                const selected = boxBlock.styleId === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={styles.styleButton}
                    data-selected={selected}
                    aria-pressed={selected}
                    title={`/${style.commandName}`}
                    data-testid={`box-style-${style.id}`}
                    onClick={() => onStyleChange(style.id)}
                  >
                    <BoxStylePreview styleId={style.id} frame={style.frame} />
                    <span className={styles.styleLabel}>{style.displayName}</span>
                    <span className={styles.styleDescription}>{style.description}</span>
                  </button>
                );
              })}
            </Grid>
          </Stack>

          <Grid columns={2} gap="xl" className={styles.settingsGrid}>
            <Stack as="section" gap="md" aria-labelledby="box-settings-frame-heading">
              <SectionHeading id="box-settings-frame-heading" title={t("box.frame")} />
              <Grid columns={2} gap="md">
                <NumberField
                  label={t("box.borderWidth")}
                  value={resolvedFrame.borderWidthPx ?? 1}
                  min={0}
                  max={5}
                  step={0.1}
                  onChange={(borderWidthPx) => onFrameChange({ borderWidthPx })}
                />
                <label className={styles.field}>
                  <span>{t("box.borderColor")}</span>
                  <span className={styles.colorField}>
                    <input
                      type="color"
                      value={htmlColorValue(borderColor)}
                      onChange={(event) => onFrameChange({ borderColor: event.target.value })}
                    />
                    <output>{borderColor}</output>
                  </span>
                </label>
              </Grid>

              <ControlGroup label={t("box.corner")}>
                <SegmentedButton
                  selected={(resolvedFrame.cornerStyle ?? "sharp") === "sharp"}
                  onClick={() => onFrameChange({ cornerStyle: "sharp" })}
                >
                  {t("box.cornerSharp")}
                </SegmentedButton>
                <SegmentedButton
                  selected={resolvedFrame.cornerStyle === "round"}
                  onClick={() => onFrameChange({
                    cornerStyle: "round",
                    ...(!resolvedFrame.radiusPx ? { radiusPx: 4 } : {}),
                  })}
                >
                  {t("box.cornerRounded")}
                </SegmentedButton>
              </ControlGroup>

              {resolvedFrame.cornerStyle === "round" ? (
                <NumberField
                  label={t("box.cornerRadius")}
                  value={resolvedFrame.radiusPx ?? 4}
                  min={0}
                  max={32}
                  step={1}
                  onChange={(radiusPx) => onFrameChange({ radiusPx })}
                />
              ) : null}

              <ControlGroup label={t("box.titlePosition")}>
                {([
                  ["l", t("box.titleLeft")],
                  ["c", t("box.titleCenter")],
                  ["r", t("box.titleRight")],
                ] as const).map(([value, label]) => (
                  <SegmentedButton
                    key={value}
                    selected={(resolvedFrame.titlePosition ?? "l") === value}
                    onClick={() => onFrameChange({ titlePosition: value })}
                  >
                    {label}
                  </SegmentedButton>
                ))}
              </ControlGroup>
            </Stack>

            <Stack as="section" gap="md" aria-labelledby="box-settings-padding-heading">
              <Inline justify="between" align="center">
                <SectionHeading id="box-settings-padding-heading" title={t("box.padding")} />
                <div className={styles.modeSwitch} role="group" aria-label={t("box.paddingModeAria")}>
                  <SegmentedButton selected={paddingMode === "all"} onClick={() => setPaddingMode("all")}>
                    {t("box.paddingAll")}
                  </SegmentedButton>
                  <SegmentedButton selected={paddingMode === "sides"} onClick={() => setPaddingMode("sides")}>
                    {t("box.paddingEach")}
                  </SegmentedButton>
                </div>
              </Inline>

              {paddingMode === "all" ? (
                <NumberField
                  label={t("box.paddingAllValue")}
                  value={uniformPadding}
                  placeholder={t("box.paddingMixed")}
                  min={0}
                  max={200}
                  step={1}
                  onChange={(value) => onFrameChange({
                    paddingPx: {
                      top: value,
                      right: value,
                      bottom: value,
                      left: value,
                    },
                  })}
                />
              ) : (
                <Grid columns={2} gap="md">
                  <NumberField
                    label={t("box.paddingTop")}
                    value={padding.top}
                    min={0}
                    max={200}
                    step={1}
                    onChange={(value) => patchPadding("top", value)}
                  />
                  <NumberField
                    label={t("box.paddingRight")}
                    value={padding.right}
                    min={0}
                    max={200}
                    step={1}
                    onChange={(value) => patchPadding("right", value)}
                  />
                  <NumberField
                    label={t("box.paddingBottom")}
                    value={padding.bottom}
                    min={0}
                    max={200}
                    step={1}
                    onChange={(value) => patchPadding("bottom", value)}
                  />
                  <NumberField
                    label={t("box.paddingLeft")}
                    value={padding.left}
                    min={0}
                    max={200}
                    step={1}
                    onChange={(value) => patchPadding("left", value)}
                  />
                </Grid>
              )}
            </Stack>
          </Grid>
        </Stack>
      </ModalBody>
    </ModalFrame>
  );
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return <h3 className={styles.sectionHeading} id={id}>{title}</h3>;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | "";
  min: number;
  max: number;
  step: number;
  placeholder?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(nextValue)) {
            onChange(nextValue);
          }
        }}
      />
    </label>
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.controlGroup}>
      <span>{label}</span>
      <div className={styles.segmentedControl} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function SegmentedButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.segmentedButton}
      data-selected={selected}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BoxStylePreview({ styleId, frame }: { styleId: string; frame: BoxFrameSpec }) {
  const t = useT("settings");
  const className = boxFrameClassName(`${styles.stylePreview} sigma-doc-box-block`, frame, styleId);
  return (
    <span
      className={className}
      data-box-style={styleId}
      style={boxFrameStyleVars(frame) as CSSProperties}
      {...boxFrameDecorationAttributes(frame)}
      aria-hidden="true"
    >
      <span className="sigma-doc-box-corner top-left" />
      <span className="sigma-doc-box-corner top-right" />
      <span className="sigma-doc-box-corner bottom-left" />
      <span className="sigma-doc-box-corner bottom-right" />
      <span className="sigma-doc-box-title">{t("box.previewTitle")}</span>
      <span className="sigma-doc-box-body">
        <span className={styles.previewLine} />
        <span className={styles.previewLine} />
      </span>
    </span>
  );
}

function hasUniformPadding(padding: BoxSpacingPx): boolean {
  return padding.top === padding.right &&
    padding.top === padding.bottom &&
    padding.top === padding.left;
}

function htmlColorValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}
