/**
 * 存储库：宽屏 / 上下分档时，列表挂在 Git 总览左栏的顶部（分支树之上），
 * 行式紧凑，切换仓库时分支、提交列表、存储库列表同屏可见；手机 / 窄档与
 * 「当前目录不是仓库」时它是独立页签，用卡片铺列，好数清有几份检出。
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的。颜色一律走 --dsw-alias-*。
 */
export const CSS = `
/* The overview's left column, upper block: a header and one row per checkout.
 * It caps its own height so a workspace with many checkouts still leaves the
 * branch tree most of the column; the list itself scrolls. */
.gp-repolist{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;max-height:38%;padding:6px 0 4px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-repolist__head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none;padding:0 10px 4px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:10px;line-height:16px;text-align:center;box-sizing:border-box}
.gp-repolist__list{list-style:none;margin:0;padding:0;min-height:0;overflow:auto}
.gp-repolist__row{margin:0;min-width:0}
.gp-repolist__item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:5px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gp-repolist__item:hover:not(.gp-repolist__item--active){background:var(--dsw-alias-interactive-bg-hover)}
.gp-repolist__item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* The checked row keeps its fill while hovered, like the branch / commit /
 * change rows; it is also the row a click does nothing on. */
.gp-repolist__item--active{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar);cursor:default}
.gp-repolist__icon{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__item--active .gp-repolist__icon{color:var(--dsw-alias-state-business-primary)}
.gp-repolist__text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.gp-repolist__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__branch{display:inline-flex;align-items:center;gap:3px;flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__branch--detached{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.gp-repolist__path{font-family:var(--dsw-font-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__count{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:10px;line-height:16px;text-align:center;box-sizing:border-box}
/* Stacked: the left column is a band above the history, so the list may take a
 * little more of it before the branch tree starts scrolling. */
.gp-panel[data-layout="stacked"] .gp-repolist{max-height:34%}
/* Strip (a cwd that is not a checkout): the same rows above the file tree.
 * Wrapping beats a tall column here — the browser below must keep its height. */
.gp-repolist--strip{max-height:none;padding:8px 10px 10px;background:var(--dsw-alias-bg-layer-1)}
.gp-repolist--strip .gp-repolist__list{display:flex;flex-wrap:wrap;gap:6px;max-height:128px;overflow:auto}
.gp-repolist--strip .gp-repolist__row{flex:0 1 auto;max-width:280px}
.gp-repolist--strip .gp-repolist__item{min-width:180px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.gp-repolist--strip .gp-repolist__item--active{border-color:transparent}
/* The strip rides above the browser: the shell keeps the file area scrolling
 * instead of letting the strip shrink with it. */
.gp-files-shell{display:flex;flex-direction:column;width:100%;min-width:0;min-height:0;height:100%}
.gp-files-shell>.gp-files{flex:1 1 auto;min-height:0}
/* A switch keeps the previous sample on screen: dim the body so the stale panes
 * read as "being replaced" rather than as the new checkout's state. */
.gp-panel[data-repo-switching="true"] .gp-body{opacity:.55;transition:opacity .12s ease}
/* Standalone page (compact layout, and a cwd that is not a checkout): the list
 * is the whole pane, so it keeps the card grammar — one card per checkout,
 * laid out in as many columns as the width allows. */
.gp-repos{display:flex;flex-direction:column;gap:10px;width:100%;flex:1 1 auto;height:100%;min-height:0;overflow:auto;padding:10px 12px;box-sizing:border-box}
.gp-repos__hint{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.gp-repos__list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.gp-repos__row{margin:0;min-width:0}
.gp-repos__item{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:56px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gp-repos__item:hover:not(.gp-repos__item--active){background:var(--dsw-alias-interactive-bg-hover)}
.gp-repos__item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-repos__item--active{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar);border-color:transparent;cursor:default}
.gp-repos__icon{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-repos__item--active .gp-repos__icon{color:var(--dsw-alias-state-business-primary)}
.gp-repos__text{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.gp-repos__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repos__path{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repos__branch{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gp-repos__branch--detached{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.gp-repos__count{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:11px;line-height:18px;text-align:center;box-sizing:border-box}
/* Compact (phone / squeezed): the hint costs the list a row it cannot spare,
 * the columns collapse to one, and the cards grow to a thumb-sized target. */
.gp-panel[data-layout="compact"] .gp-repos{padding:8px}
.gp-panel[data-layout="compact"] .gp-repos__hint{display:none}
.gp-panel[data-layout="compact"] .gp-repos__list{grid-template-columns:1fr}
.gp-panel[data-layout="compact"] .gp-repos__item{min-height:44px;padding:8px 10px}
`;
