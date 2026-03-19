This folder mirrors `specifications.xlsx` into plain-text TSV files so changes show up cleanly in git diffs.

Regenerate it with:

```bash
npm run specs:export-text
```

Notes:
- One file is written per workbook sheet, in workbook order.
- Embedded newlines are escaped as `\n` so each spreadsheet row stays on one diffable line.
- The `.xlsx` workbook can still be the editing source; this folder is the readable and diff-friendly mirror.
