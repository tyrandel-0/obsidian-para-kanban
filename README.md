# PARA Kanban

A customizable **kanban view for [Obsidian Bases](https://help.obsidian.md/bases)**.
Group any base by a property and get a drag-and-drop board — plus a few extras built for
real day-to-day task and project management.

It's a fork of [`xiwcx/obsidian-bases-kanban`](https://github.com/xiwcx/obsidian-bases-kanban)
with four additions on top: template-based card creation, delete-from-card, a board
height cap, and hideable columns.

## Features

- **Drag-and-drop board** — group a base by any property; dragging a card updates that
  property in the note's frontmatter. Columns and cards reorder by drag; columns can be
  colored. Optional swimlanes (a second grouping axis).
- **Create cards from a template** — the per-column **+** button creates a new note from a
  template file you choose, then sets the grouped property to that column. You only type a
  title. Supports a small set of tokens (date, title, column — see below).
- **Show properties on cards** — any property listed in the view's display order is shown
  on each card (empty values and the grouped property itself are skipped).
- **Delete from the card** — a trash button on each card (revealed on hover) moves the note
  to trash after a confirmation, respecting your "Deleted files" setting.
- **Board height cap** — cap the board's height (px) so a tall column scrolls internally
  instead of stretching the whole note. Handy when a kanban is embedded inside a note.
- **Hide columns** — hide a column from the board; hidden columns collect into a bar above
  the board and can be restored with one click. Their data is untouched.

## Installation

### Via BRAT (recommended while this isn't in the community store)

1. Install the **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** community plugin.
2. BRAT → *Add a beta plugin* → enter `tyrandel-0/obsidian-para-kanban`.
3. Enable **PARA Kanban** in *Settings → Community plugins*.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/tyrandel-0/obsidian-para-kanban/releases) into
`<vault>/.obsidian/plugins/para-kanban/`, then enable the plugin.

## Usage

Add a `kanban` view to a base and pick a **Group by** property. In a `.base` code block:

```base
filters:
  and:
    - file.folder == "Tasks"
views:
  - type: para-kanban-view
    name: Board
    groupByProperty: Status
    order:
      - Project
      - Due
    boardMaxHeight: 600
    quickAddFolder: Tasks
    templateFile: Templates/Task.md
```

### View options

| Option | Key | What it does |
|---|---|---|
| Group by | `groupByProperty` | Property used for columns (required). |
| Swimlane by | `swimlaneByProperty` | Optional second grouping axis (rows). |
| Add card to column folder | `quickAddFolder` | Folder new cards are created in. Required for the **+** button. |
| New card template | `templateFile` | Template note the **+** button fills the new card from. |
| Board max height (px) | `boardMaxHeight` | Cap board height; `0` = no cap. Columns scroll internally above it. |
| Card title property | `cardTitleProperty` | Use a property as the card title instead of the file name. |
| Image property | `imageProperty` | Show a cover image from a property. |
| Wrap property values | `wrapPropertyValues` | Wrap long property values on cards. |

Card display properties come from the view's property order (the *Properties* toolbar menu,
or `order:` in the base).

### Template tokens

When `templateFile` is set, the whole template (frontmatter + body) is processed before the
note is created. Tokens are case-insensitive:

| Token | Replaced with |
|---|---|
| `{{title}}` / `{{value}}` | the card title you typed |
| `{{column}}` | the column (grouped value) the card is created in |
| `{{date}}` / `{{date:FORMAT}}` | current date (`YYYY MM DD HH mm ss A a`) |
| `{{time}}` / `{{time:FORMAT}}` | current time |
| `{{value:anything}}` | empty string (no interactive prompts here) |

After the body is written, the grouped property (e.g. `Status`) is forced to the column
value, so a card always lands where you created it.

## Development

```bash
npm install
npm run dev        # watch build → dist/
npm run build      # production build → dist/{main.js,manifest.json,styles.css}
npm run typecheck
npm test
npm run lint
```

`PARA_KANBAN_OUT=/path/to/vault/.obsidian/plugins/para-kanban npm run build` also copies the
built files into that vault for quick local testing. Pushing to `main` triggers CI, which
builds and publishes a GitHub release matching the `manifest.json` version.

## Credits & license

Fork of [obsidian-bases-kanban](https://github.com/xiwcx/obsidian-bases-kanban) by
I. Welch Canavan. Licensed under [MIT](LICENSE); original copyright retained.
