# dsh-git-panel

English | [简体中文](README.md)

![dsh-git-panel](docs/assets/banner.png)

`dsh-git-panel` is a DSH Web GUI plugin that brings an IDE-style Git panel into the conversation workspace. It gathers the branch list, commit history graph, uncommitted-change commit & amend, and syntax-highlighted diffs into one resident tab, and puts a zsh-style branch marker at the left of the input bar — so you can check repo status and commit changes mid-conversation without switching to a terminal or a separate IDE.

The panel only reads the Git repository at the current session's working directory. Every git command runs through the host subprocess service as an argv array — no shell string concatenation — with the working directory locked to the repository root and per-command timeout and output caps. The plugin never touches your git config, and every write (commit, amend, stage, discard) has an explicit entry point.

## Install

```bash
# Stable release (npm)
dsh plugin --profile web add @xbzbing/dsh-git-panel@latest

# Pre-release (GitHub Release asset; never published to npm)
dsh plugin add https://github.com/xbzbing/dsh-git-panel/releases/download/v1.8.0-rc.1/xbzbing-dsh-git-panel-1.8.0-rc.1.tgz
```

Pre-release versions carry a `-` suffix (e.g. `1.8.0-rc.1`): they appear only as GitHub prereleases, are never pushed to npm, and never trigger the in-panel "update available" prompt. A stable release ships to npm and as a stable GitHub Release at the same time. `lib/` is not committed to the repository — do not install with `dsh plugin add github:…`; use the npm or Release asset URL above.

After installing or updating, the **Git** panel appears in the workspace tab bar (after Chat and Trajectory) with no service restart and no page refresh: dsh's hmr watches the profile's `package.json` and patch files and mounts the plugin live, while the client bundle (`lib/client.js`) is picked up within a second of being replaced and pushed to the browser over `/plugins/events`, where the old fiber is torn down and the new code remounted in place — already-open pages get the update without reloading. Only host-half modules (`lib/host/*.js`, whose loaded code keeps running until the next restart) and profile changes made while hmr is unavailable still need a restart. In-panel settings (the input-bar marker toggle and the default diff view on the detail page) are hot-written and apply immediately.

> **Compatibility**: verified on `dsh@0.2.1-rc.2` — installation, the Git panel, the input-bar marker, and the host RPC all work normally.

## Features

- **Overview** — three columns: the branch / tag list, a searchable (commit message, hash, author, date) commit history graph, and the selected commit's changed-file tree and message; click a file to see its diff within that commit in a modal.
- **Changes** — per-file stage / unstage / discard and batch discard of the checked changes (with confirmation), manual commit and **Amend**, stash (create / apply / pop / drop), plus file-count and added·deleted statistics.
- **Common Git actions** — switch branch (a remote ref becomes a same-named tracking branch, never a detached HEAD; uncommitted changes can be stashed first), create and delete tags, and revert / reset a commit (hard reset lists the changes it will discard and requires an extra acknowledgement). All of them only rewrite the local repository and never push automatically.
- **AI commit-message suggestion** — writes a commit message from the current uncommitted changes in the style of the repository's existing commits, with the language inferred from the repository history by default (or pinned to 中文 / English); the model can be pinned on the detail page from the DSH model list (provider → model → reasoning-effort cascade, **following the current session by default**), where the suggestion can also be turned off and the input budget, output limit, and timeout tuned. **Generation sends your diff content to the provider of the model you picked.**
- **Input-bar Git marker** — a zsh-style `<repo> (<branch>)`, green when in sync and orange when there are uncommitted changes; hover shows the repository path and a click jumps to the panel. It can be turned off on the plugin detail page, which moves the status to a dot beside the Git tab.
- **File browser** — browse the workspace tree inside the panel (loaded on demand, `.gitignore` entries dimmed, `.git` hidden) and preview code / Markdown / HTML / images (local images embedded in rendered Markdown display inline, e.g. README figures; ```mermaid fences render as diagrams with a code-block fallback); the source preview wraps long lines by default and can switch to horizontal scrolling; it also works outside a Git repository, rooted at the current working directory.
- **Diff and source viewing** — unified / split / before / after views with syntax highlighting, word-level emphasis, on-demand expansion of hidden context, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> find-in-place; images zoom around the cursor (10%–800%) and can be panned by dragging or opened fullscreen.
- **Narrow panel / mobile** — at 620px wide or below the UI switches to a single-column drill-in (branch filter as a bottom sheet, two-line commit rows) and restores the three columns when widened.
- **Shared-worktree guards** — write actions share the repository with the dsh AI, so dialog footers suggest letting the AI run Git for you; a `.git/index.lock` clash retries once and reports a friendly "Git is busy".
- The UI follows the DSH system language, in Simplified Chinese and English.

## Permissions and data boundaries

The panel runs with the DSH process's privileges. These are the boundaries worth knowing before installing:

- **Git commands** — every git command goes through the host `subprocess` service: argv arrays, no shell string concatenation, cwd locked to the repository root, with a per-command timeout and output caps. It never uses `--force` and never touches your git config.
- **File access** — it only reads files inside the workspace (diffs, file browser, the AI-suggestion input), after validation plus a realpath containment check: symlinks pointing outside the repository are refused and `.git` is not browsable. The one write is **discarding an untracked entry** — it deletes the working-tree file after your confirmation, and refuses the whole batch when an entry is itself a Git repository.
- **Network** — the plugin itself makes exactly one request, `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`, for the "new version available" notice in the version bar (5 s timeout, cached in-process). `fetch` / `pull` / `push` / `publish` reach the network only after you click, through git commands, and credentials stay with git: the plugin never reads, stores, or returns a token or credential.
- **External service** — only "AI commit message" sends diff content to the model provider you configured in DSH; the host performs the call and the plugin holds no credentials.
- **System dependency** — the `git` CLI. Without git, or outside a Git repository, only the file browser is shown, rooted at the current working directory.

The client bundle (`lib/client.js`) makes no network requests of its own — it talks to the host over same-origin RPC — and the plugin collects no telemetry. UI-only preferences such as the panel font size and pane widths live in browser localStorage and never contain repository content. Apart from git commands and the confirmed deletion, the plugin's code reads and writes nothing outside the workspace; the detail-page settings are persisted by the host into the profile config.

## Screenshots

| Overview | File-diff modal |
| :---: | :---: |
| ![Overview: branches, commit graph, commit detail, hover card](docs/assets/screenshots/1-git-panel-overview.png) | ![File-diff modal: syntax-highlighted unified / split diff with on-demand gap expansion and word-level emphasis](docs/assets/screenshots/2-overview-tab.png) |
| Changes | File browser |
| ![Changes: stats bar, uncommitted list, commit box, diff](docs/assets/screenshots/3-changes.png) | ![File browser: lazy directory tree, official type icons, dimmed ignored entries, and file preview](docs/assets/screenshots/4-files.png) |
| Narrow / mobile | Plugin config |
| ![Narrow / mobile: single-column drill-in layout with stats bar, change list, and commit box](docs/assets/screenshots/5-mobile-panel.png) | ![Plugin config: marker toggle, default diff view, graph style, and AI generation settings](docs/assets/screenshots/6-plugin-config.png) |

## Architecture

Two halves communicating over the typert Remote gateway.

- **Host** (`lib/host/`) — a Cordis + typert `GitPanelService` on the `gitPanel` namespace, exposing `snapshot` / `run` / `query` / `suggest` / `version` and doing only endpoint delegation and lifecycle wiring; git runs through the host `subprocess` service (argv arrays, no shell, cwd locked to the repository root, timeout + output caps); the `suggest` endpoint makes a one-shot commit-message call through the host `llm` service with your configured model.
- **Client** (`lib/client.js`) — a React bundle that registers the `conversation.view` panel and the `conversation.input.left` marker. One snapshot controller per session (polling + a refresh after each turn + a reload on connection reset) feeds the marker, the changes page, and the stats bar from a single snapshot, avoiding duplicate git commands.

## Development

```bash
node build.mjs      # tsc (host d.ts) + esbuild (per-module host js + client bundle + testkit)
npm run typecheck   # type check
npm run test:unit   # pure-algorithm and host-endpoint unit tests (node --test)
npm run test:e2e    # isolated file:// headless-browser e2e (never touches a running instance)
npm test            # unit + e2e
```

The host output is emitted one file per `src/host/` module (stack traces land in the module that raised) and is never minified: the typert gateway validates arguments by method parameter name, and minification would rename them and break the wire contract. Client changes are hot-reloaded: after rebuilding `lib/client.js`, the running dsh detects the file change within a second and pushes it to the browser for an in-place swap (old fiber torn down, new code remounted) — no page refresh needed; host changes still need a restart, since loaded modules keep running their previous code. `lib/` is local build output and is not committed; for local development, add the plugin to a dsh web profile's `dsh.profile.bundles` with a `file:` dependency pointing at this directory, then run `node build.mjs`.

## Project structure

```text
src/
  host/
    types.ts        the single source of truth for the wire data model (reused by the client)
    index.ts        GitPanelService: endpoint delegation + lifecycle wiring
    git.ts          subprocess → a GitRunner with timeouts
    core.ts         workspace resolution + snapshotForSession
    actions.ts      GitAction → git command sequences (commit / amend / stage …)
    queries.ts      history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / worktree-stats
    suggest.ts      AI commit-message suggestion (diff collection + language inference + one ctx.llm call)
    parser.ts       git output parsed into structured data
    version.ts      package version + GitHub release update check
  client/
    rpc.ts          the client face of the gitPanel endpoints
    controller.ts   per-session snapshot controller
    Panel.tsx       panel shell: sub-tab routing + version bar
    OverviewTab.tsx Overview three columns + hover card
    ChangesTab.tsx  changes page
    FilesTab.tsx    file browser (lazy directory tree + file preview)
    DiffView.tsx    diff view (unified / split / before / after)
    GitPill.tsx     input-bar marker
    code-spans.ts   split syntax tokens at word-level change ranges
    git-graph.ts    commit-graph lane layout
    file-tree.ts    file paths folded into a tree
    diff.ts         unified diff → side-by-side rows + inline rows + stats
```

## License

[MIT License](LICENSE).
