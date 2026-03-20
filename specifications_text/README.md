This folder stores the game specifications as plain-text CSV files so they open directly in Excel and still diff cleanly in git.

If you bring back `specifications.xlsx`, you can regenerate these CSVs with:

```bash
npm run specs:export-text
```

Notes:
- One file is written per spec sheet, in workbook order when exported from `.xlsx`.
- Embedded newlines are escaped as `\n` so each spreadsheet row stays on one diffable line.
- These CSV files can also be edited directly and are the git-tracked source in the current setup.
