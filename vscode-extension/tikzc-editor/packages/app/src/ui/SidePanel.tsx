import React, { type ReactNode } from "react";
import css from "./SidePanel.module.css";

export type SidePanelProps = {
  children: ReactNode;
  className?: string;
};

export function SidePanel({ children, className }: SidePanelProps) {
  return <div className={[css.panel, className].filter(Boolean).join(" ")}>{children}</div>;
}

export type SidePanelHeaderProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.Header = function SidePanelHeader({ children, className }: SidePanelHeaderProps) {
  return <div className={[css.header, className].filter(Boolean).join(" ")} data-select="chrome">{children}</div>;
};

export type SidePanelContentProps = {
  children: ReactNode;
  className?: string;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
};

SidePanel.Content = React.forwardRef<HTMLDivElement, SidePanelContentProps>(
  function SidePanelContent({ children, className, onScroll }, ref) {
    return (
      <div
        ref={ref}
        className={[css.content, className].filter(Boolean).join(" ")}
        onScroll={onScroll}
      >
        {children}
      </div>
    );
  }
);

export type SidePanelSectionProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.Section = function SidePanelSection({ children, className }: SidePanelSectionProps) {
  return <section className={[css.section, className].filter(Boolean).join(" ")}>{children}</section>;
};

export type SidePanelSectionHeaderProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.SectionHeader = function SidePanelSectionHeader({ children, className }: SidePanelSectionHeaderProps) {
  return <div className={[css.sectionHeader, className].filter(Boolean).join(" ")} data-select="chrome">{children}</div>;
};

export type SidePanelSectionBodyProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.SectionBody = function SidePanelSectionBody({ children, className }: SidePanelSectionBodyProps) {
  return <div className={[css.sectionBody, className].filter(Boolean).join(" ")}>{children}</div>;
};

export type SidePanelFooterProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.Footer = function SidePanelFooter({ children, className }: SidePanelFooterProps) {
  return <div className={[css.footer, className].filter(Boolean).join(" ")} data-select="chrome">{children}</div>;
};
