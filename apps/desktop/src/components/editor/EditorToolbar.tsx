"use client";

import type {
  ButtonHTMLAttributes,
  MouseEvent,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from "react";

import { Tooltip } from "@/components/ui/Tooltip";
import type { TooltipContent } from "@/components/ui/Tooltip";

export const EDITOR_TOOLBAR_ICON_SIZE = 17;
export const EDITOR_TOOLBAR_TEXT_ICON_SIZE = 16;
export const EDITOR_TOOLBAR_CARET_SIZE = 13;

type ToolbarButtonType = NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["type"]>;

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function EditorToolbar({
  ariaLabel,
  bordered = false,
  className,
  children,
}: {
  ariaLabel?: string;
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={joinClassNames("quick-toolbar-row", bordered && "bordered", className)}
      aria-label={ariaLabel}
      data-editor-toolbar="quick"
    >
      {children}
    </div>
  );
}

export function EditorToolbarGroup({
  ariaLabel,
  push = false,
  className,
  children,
}: {
  ariaLabel?: string;
  push?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={joinClassNames("toolbar-group flat", push && "push", className)} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function EditorToolbarSeparator() {
  return <div className="toolbar-splitter" aria-hidden="true" />;
}

type SharedToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  buttonRef?: Ref<HTMLButtonElement>;
  active?: boolean;
  preserveFocus?: boolean;
  /** 記号だけでは結果が曖昧な操作に限って表示する短い補足。 */
  tooltip?: TooltipContent;
};

function callToolbarMouseDown(
  event: MouseEvent<HTMLButtonElement>,
  preserveFocus: boolean,
  onMouseDown: ButtonHTMLAttributes<HTMLButtonElement>["onMouseDown"],
) {
  if (preserveFocus) {
    event.preventDefault();
  }
  onMouseDown?.(event);
}

export function EditorToolbarIconButton({
  buttonRef,
  active = false,
  danger = false,
  withText = false,
  large = false,
  preserveFocus = true,
  tooltip,
  className,
  type = "button",
  onMouseDown,
  children,
  ...buttonProps
}: SharedToolbarButtonProps & {
  danger?: boolean;
  withText?: boolean;
  /** Word風リボンの大ボタン（アイコンの下にラベル）。見た目は ribbon-chrome.css の word スコープ。 */
  large?: boolean;
  type?: ToolbarButtonType;
}) {
  const button = (
    <button
      ref={buttonRef}
      type={type}
      className={joinClassNames("icon-button", withText && "with-text", large && "large", danger && "danger", active && "active", className)}
      onMouseDown={(event) => callToolbarMouseDown(event, preserveFocus, onMouseDown)}
      {...buttonProps}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip {...tooltip}>{button}</Tooltip> : button;
}

const MENU_BUTTON_VARIANT_CLASS = {
  boxedText: "boxed-text-menu-button",
  lineHeight: "line-height-menu-button",
  textAlign: "text-align-menu-button",
  lineDash: "line-dash-menu-button",
  lineWidth: "line-width-menu-button",
  lineEndpoint: "line-endpoint-menu-button",
} as const;

export function EditorToolbarMenuButton({
  buttonRef,
  active = false,
  activeFormat = false,
  variant,
  preserveFocus = true,
  tooltip,
  className,
  type = "button",
  onMouseDown,
  children,
  ...buttonProps
}: SharedToolbarButtonProps & {
  activeFormat?: boolean;
  variant?: keyof typeof MENU_BUTTON_VARIANT_CLASS;
  type?: ToolbarButtonType;
}) {
  const button = (
    <button
      ref={buttonRef}
      type={type}
      className={joinClassNames(
        "shape-menu-button icon-only",
        variant ? MENU_BUTTON_VARIANT_CLASS[variant] : undefined,
        active && "active",
        activeFormat && "active-format",
        className,
      )}
      onMouseDown={(event) => callToolbarMouseDown(event, preserveFocus, onMouseDown)}
      {...buttonProps}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip {...tooltip}>{button}</Tooltip> : button;
}

export function EditorToolbarSelect({
  compact = false,
  fontFamily = false,
  className,
  children,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & {
  compact?: boolean;
  fontFamily?: boolean;
}) {
  return (
    <select
      className={joinClassNames("toolbar-select", compact && "compact", fontFamily && "font-family-select", className)}
      {...selectProps}
    >
      {children}
    </select>
  );
}

export function EditorToolbarColorButton({
  buttonRef,
  active = false,
  text = false,
  preserveFocus = true,
  tooltip,
  className,
  type = "button",
  onMouseDown,
  children,
  ...buttonProps
}: SharedToolbarButtonProps & {
  text?: boolean;
  type?: ToolbarButtonType;
}) {
  const button = (
    <button
      ref={buttonRef}
      type={type}
      className={joinClassNames("toolbar-icon-color", text && "toolbar-icon-color-text", active && "active", className)}
      onMouseDown={(event) => callToolbarMouseDown(event, preserveFocus, onMouseDown)}
      {...buttonProps}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip {...tooltip}>{button}</Tooltip> : button;
}
