export type BadgeKind = "auth" | "access" | "range" | "stale" | "fetch" | "offline";

export interface BadgeOpts {
  kind: BadgeKind;
  text: string;
  tooltip?: string;
  onClick?: () => void;
}

export function renderBadge(parent: HTMLElement, opts: BadgeOpts): HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const span = (parent as any).createSpan({ cls: `spread-sync-badge spread-sync-badge--${opts.kind}` }) as HTMLElement;
  span.setText(opts.text);
  if (opts.tooltip) span.setAttribute("aria-label", opts.tooltip);
  if (opts.onClick) {
    span.addEventListener("click", (e) => {
      e.preventDefault();
      opts.onClick!();
    });
    span.style.cursor = "pointer";
  }
  return span;
}
