/**
 * 存储库页签：一行一个仓库，选中的那行用三处列表共用的选中语言
 * （主色淡底 + 3px 内嵌左边条）。层叠顺序即本文件的挂载顺序（见 styles.ts
 * 的 CSS_PARTS）：写在后面的模块覆盖前面的。颜色一律走 --dsw-alias-*。
 */
export const CSS = `
/* The page scrolls on its own: a workspace can hold dozens of checkouts and
 * the panel body must not stretch with them. */
.gp-repos{display:flex;flex-direction:column;gap:10px;width:100%;flex:1 1 auto;height:100%;min-height:0;overflow:auto;padding:10px 12px;box-sizing:border-box}
.gp-repos__hint{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.gp-repos__empty{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.gp-repos__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.gp-repos__row{margin:0}
.gp-repos__item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gp-repos__item:hover:not(.gp-repos__item--active){background:var(--dsw-alias-interactive-bg-hover)}
.gp-repos__item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* The checked row keeps the fill while hovered, like the commit / change /
 * file rows; it is also the row a click does nothing on. */
.gp-repos__item--active{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar);cursor:default}
.gp-repos__icon{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-repos__item--active .gp-repos__icon{color:var(--dsw-alias-state-business-primary)}
.gp-repos__text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.gp-repos__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repos__path{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repos__branch{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gp-repos__branch--detached{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.gp-repos__count{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:11px;line-height:18px;text-align:center;box-sizing:border-box}
/* Compact (phone / squeezed): the hint costs the list a row it cannot spare,
 * and the rows grow to a thumb-sized target. */
.gp-panel[data-layout="compact"] .gp-repos{padding:8px}
.gp-panel[data-layout="compact"] .gp-repos__hint{display:none}
.gp-panel[data-layout="compact"] .gp-repos__item{min-height:40px;padding:8px 10px}
`
