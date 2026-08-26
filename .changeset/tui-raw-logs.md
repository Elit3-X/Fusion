---
"@runfusion/fusion": minor
---

summary: Press [v] in the TUI Logs panel for a chrome-free view you can select and copy with the mouse.
category: feature
dev: The Logs panel already fills the pane when focused, but keeps a panel border, title, filter row, header and status bar, so a rectangular terminal drag captures box-drawing characters and neighbouring rows; mouse reporting is also enabled there for wheel scrolling and swallows the drag entirely. New `logsRawMode` (controller + state) renders only plain log lines starting at column 0, replaces the whole frame except one trailing hint row, and is excluded from `wantsMouse` so native click-drag selection works. Toggled with `[v]`, left with `[v]` or Esc (ordered ahead of the expanded-entry escape), and listed in the help overlay. Line shape matches the existing `[c]` single-line copy, so a mouse selection and a keyboard copy produce identical text.
