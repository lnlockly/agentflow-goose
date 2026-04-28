import { useTranslation } from "react-i18next";
import {
  IconLayoutSidebar,
  IconLayoutSidebarFilled,
} from "@tabler/icons-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useTopBarActions } from "@/app/contexts/TopBarActionsContext";
import type { AppView } from "@/app/AppShell";

interface TopBarProps {
  onSettingsClick?: () => void;
  activeView?: AppView;
  chatSessionTitle?: string;
  className?: string;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const PAGE_LABELS: Partial<Record<AppView, string>> = {
  skills: "Skills",
  agents: "Agents",
  projects: "Projects",
  "session-history": "Session History",
};

export function TopBar({
  onSettingsClick,
  activeView,
  chatSessionTitle,
  className,
  sidebarCollapsed,
  onToggleSidebar,
}: TopBarProps) {
  const { t } = useTranslation("settings");
  const { t: tSidebar } = useTranslation("sidebar");
  const pageLabel =
    activeView === "chat"
      ? chatSessionTitle
      : activeView
        ? PAGE_LABELS[activeView]
        : undefined;
  const viewActions = useTopBarActions();
  const ToggleIcon = sidebarCollapsed
    ? IconLayoutSidebar
    : IconLayoutSidebarFilled;
  const toggleLabel = sidebarCollapsed
    ? tSidebar("actions.expand")
    : tSidebar("actions.collapse");

  return (
    <header
      className={cn("flex h-16 items-center gap-2 pl-20 pr-3", className)}
      data-tauri-drag-region
    >
      {onToggleSidebar && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="text-muted-foreground hover:text-foreground"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <ToggleIcon className="size-4" />
        </Button>
      )}
      <h1
        className="font-sans text-[24px] leading-[0.96] tracking-[-0.04em] text-[var(--text-title-alex)]"
        data-tauri-drag-region
      >
        {/* i18n-check-ignore: placeholder for dynamic project title — will be replaced when Projects page ships */}
        Tulsi's World
        {pageLabel && (
          <>
            <span className="text-[var(--text-muted-alex)] opacity-60">
              {" "}
              /{" "}
            </span>
            <span className="text-[var(--text-muted-alex)]">{pageLabel}</span>
          </>
        )}
      </h1>

      <div className="min-w-0 flex-1" data-tauri-drag-region />

      {viewActions && (
        <div className="flex items-center gap-2">{viewActions}</div>
      )}

      <Button
        type="button"
        variant="ghost"
        onClick={onSettingsClick}
        className="h-8 rounded-full bg-[var(--surface-button)] px-3 text-[14px] text-black/70 hover:bg-[var(--surface-button)]/80"
        title={t("title")}
      >
        {t("title")}
      </Button>
    </header>
  );
}
