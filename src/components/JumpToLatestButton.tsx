import type { CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function JumpToLatestButton({ onClick, className, style, count = 0 }: { onClick: () => void; className?: string; style?: CSSProperties; count?: number }) {
  const label = count > 0
    ? count === 1 ? t("chat.jumpToLatestNew.one") : t("chat.jumpToLatestNew", { count })
    : t("chat.jumpToLatestAria");
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={label}
      title={t("chat.jumpToLatest")}
      className={cn("animate-pop-in absolute left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-hairline/40 bg-raised text-ink shadow-lg hover:bg-raised-hover", className)}
      style={style}
    >
      <ArrowDown size={18} aria-hidden="true" />
      {count > 0 && (
        <span data-jump-count="" aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 h-[18px] min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[18px] text-accent-ink tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
