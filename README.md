# AI Contributions for Obsidian

Accept or reject AI contributions directly in a note.
Each `[!ai]` callout has **Accept** and **Reject** buttons beside its title, including folded callouts.
The callout tag is configurable; `ai` is the default.
The controls are designed for Reading view, Live Preview, and Source mode.
TaskNotes is not required.

**Accept** removes the callout header and one outer `>` marker from every content line.
Markdown formatting, nested quotations, links, code, tables, and math remain in the content.
**Reject** removes that callout and its contents from the Markdown file.
Both actions affect just the selected callout.

For example, accepting:

```markdown
> [!ai]+ AI Contribution — 2026-10-27
> ## Proposed section
>
> Keep this paragraph and its [[Related note]] link.
```

produces:

```markdown
## Proposed section

Keep this paragraph and its [[Related note]] link.
```

## Install

Obsidian 1.5.0 or newer is required.

### With BRAT

1. Install and enable **BRAT** from **Settings → Community plugins → Browse**.
2. Open the command palette and run **BRAT: Add a beta plugin for testing** (the command may be grouped under **Plugins**).
3. Enter `https://github.com/judealnas/obsidian-ai-contributions` and choose the latest release.
4. Click **Add Plugin**, then enable **AI Contributions** under **Settings → Community plugins** if it is not already enabled.
5. Use BRAT's update command or automatic update settings to receive later releases.

BRAT installs the compiled files from [GitHub releases](https://github.com/judealnas/obsidian-ai-contributions/releases); no local build is needed.
See the [official BRAT installation guide](https://tfthacker.com/brat-quick-guide) for details.

### Manual installation

Download the plugin ZIP from [the latest release](https://github.com/judealnas/obsidian-ai-contributions/releases/latest).
For a source checkout, first run `npm ci` and `npm run package` to create the installable ZIP.

1. Extract `ai-contributions-0.2.0.zip` (or `dist/ai-contributions-0.2.0.zip` after a local build).
2. Copy the `ai-contributions` folder into `<your vault>/.obsidian/plugins/`.
3. Reload Obsidian.
4. Enable **AI Contributions** in **Settings → Community plugins**.
5. Reopen an existing note if its callouts were rendered before the plugin was enabled.

The ZIP contains the compiled plugin; Node.js and the source project are unnecessary for installation.
When updating an existing installation, disable the plugin before replacing its files and enable it afterward.

On Windows, the included installer can preview the exact destination:

```powershell
.\scripts\install.ps1 -VaultPath 'C:\Path\To\Personal Vault'
```

To install the packaged build:

```powershell
.\scripts\install.ps1 -VaultPath 'C:\Path\To\Personal Vault' -Apply
```

The installer copies plugin files and backs up any previous versions under `.obsidian/plugin-backups/`.
It leaves note files and the enabled-plugin list unchanged.

## Settings

Open **Settings → AI Contributions → Callout tag**.
Enter the name without `[!` and `]`, then click **Apply**.
For example, `assistant` enables review buttons on `> [!assistant]+ Contribution`.

The default is `ai`; an empty field resets it to `ai`.
Names accept letters, numbers, hyphens, and underscores, and are matched without regard to case.
The choice is saved per vault and applies to Reading view, Live Preview, and Source mode.
Open editor controls and Reading views refresh when it is applied.

Changing the setting selects which callout type receives review buttons; existing callouts are not renamed.
Only the configured type is reviewable, so selecting a built-in name such as `note` will add review buttons to those callouts too.

## Review and undo

- Click **Accept** to promote one contribution into ordinary Markdown.
- Click **Reject** to remove one contribution, including its title.
- Run **AI Contributions: Undo last review** from the command palette to restore the previous review.
  You can assign this command a hotkey in Obsidian settings.
- Editor actions also participate in the editor's normal undo history.

The plugin retains up to 20 reviews in memory until it is disabled or Obsidian closes.
Undo checks that the note still matches the result of that review.
If it has changed, the command stops to preserve newer edits.
Obsidian's File recovery or your usual backups can be used for older changes.

`AI_` filenames, `_AI_Generated` frontmatter, and other metadata remain in place after a review.
This allows sections of a whole AI note to be reviewed individually.
No file or directory is deleted by the plugin.

## Supported Markdown

This version targets the vault's explicit, top-level AI callout format:

- The header starts at the beginning of a line with `> [!ai]`, or the configured tag.
- `[!AI]`, expanded `+`, collapsed `-`, and custom titles are supported.
- Every body line starts with `>`; quoted empty lines use `>` or `> `.
- Separate callouts and surrounding paragraphs with an unquoted blank line.
- Nested blockquotes inside the body keep their own quote markers after acceptance.

Buttons are omitted for examples inside fenced code, frontmatter, and recognized comments or HTML blocks.
Indented callouts, callouts inside lists or other callouts, unquoted continuation lines, and callouts without a blank separator between headers are not reviewable.
These restrictions prevent the plugin from guessing which surrounding text belongs to a contribution.

Rendered Live Preview titles with Markdown formatting may need to be reviewed in the source editor or Reading view.
Embedded notes can be reviewed when Obsidian provides an unambiguous source section for their own file.
Otherwise, rendered buttons are disabled with a tooltip directing you to the original note.

## How changes are applied

Editor controls are CodeMirror 6 widgets.
When Live Preview renders a whole callout as a block widget, the plugin adds controls to its rendered title using CodeMirror's DOM position mapping.
Reading controls use Obsidian's Markdown postprocessor and source-section information.

Every button captures the source document and exact callout range it represents.
Before changing anything, the plugin verifies that the document still matches that snapshot.
It never locates a callout just by matching its body text, which could select a duplicate elsewhere.
If a note changes, refresh its controls or reopen it before trying again.

Open source editors are updated through their editor buffers, including unsaved text.
Other notes are updated through `Vault.process()` so the read and change happen together.
Review writes are serialized, and failed writes do not create undo entries.
Rejected text and undo snapshots are kept only in memory; the plugin makes no network requests and has no external service integration.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

`npm run dev` rebuilds `main.js` when source files change.
Builds and tests write inside this project.
Only the explicit installer command with `-Apply` writes plugin files into a vault.

The runtime uses the Obsidian and CodeMirror modules supplied by Obsidian.
They are excluded from the bundle.

Tests cover Markdown transformations, source mapping, button behavior, CodeMirror document changes, rendered Live Preview bindings, file-update failures, unsaved editors, embeds, stale controls, and undo.
The Obsidian API is simulated in integration tests.
Native Obsidian rendering, theme compatibility, popout windows, and mobile behavior have not been verified in this session.

API references:

- [Obsidian editor decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
- [Obsidian Vault API and atomic updates](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian TypeScript API definitions](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
- [CodeMirror API](https://codemirror.net/docs/ref/)
