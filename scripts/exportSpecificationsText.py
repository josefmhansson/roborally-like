from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK_PATH = ROOT / 'specifications.xlsx'
OUTPUT_DIR = ROOT / 'specifications_text'

XML_NS = {
    'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'docrel': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'pkgrel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Export specifications.xlsx to git-friendly CSV files.')
    parser.add_argument('--workbook', default=str(WORKBOOK_PATH))
    parser.add_argument('--output', default=str(OUTPUT_DIR))
    return parser.parse_args()


def column_ref_to_index(cell_ref: str) -> int:
    column = ''.join(char for char in cell_ref if char.isalpha())
    index = 0
    for char in column:
        index = index * 26 + ord(char.upper()) - 64
    return max(0, index - 1)


def read_shared_strings(archive: ZipFile) -> list[str]:
    shared_strings_path = 'xl/sharedStrings.xml'
    if shared_strings_path not in archive.namelist():
        return []

    root = ET.fromstring(archive.read(shared_strings_path))
    strings: list[str] = []
    for item in root.findall('main:si', XML_NS):
        text = ''.join(node.text or '' for node in item.findall('.//main:t', XML_NS))
        strings.append(text)
    return strings


def read_workbook_sheets(archive: ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    relationship_targets = {
        rel.attrib['Id']: rel.attrib['Target'] for rel in relationships.findall('pkgrel:Relationship', XML_NS)
    }

    sheets: list[tuple[str, str]] = []
    for sheet in workbook.find('main:sheets', XML_NS):
        name = sheet.attrib['name']
        relationship_id = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        target = relationship_targets[relationship_id]
        if not target.startswith('xl/'):
            target = f'xl/{target}'
        sheets.append((name, target))
    return sheets


def read_cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get('t')
    if cell_type == 'inlineStr':
        return ''.join(node.text or '' for node in cell.findall('.//main:t', XML_NS))

    value_node = cell.find('main:v', XML_NS)
    if value_node is None or value_node.text is None:
        return ''

    raw_value = value_node.text
    if cell_type == 's':
        try:
            return shared_strings[int(raw_value)]
        except (ValueError, IndexError):
            return raw_value
    if cell_type == 'b':
        return 'TRUE' if raw_value == '1' else 'FALSE'
    return raw_value


def read_sheet_rows(archive: ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(archive.read(sheet_path))
    sheet_data = root.find('main:sheetData', XML_NS)
    if sheet_data is None:
        return []

    rows: list[list[str]] = []
    for row in sheet_data.findall('main:row', XML_NS):
        values_by_index: dict[int, str] = {}
        for cell in row.findall('main:c', XML_NS):
            cell_ref = cell.attrib.get('r', '')
            values_by_index[column_ref_to_index(cell_ref)] = read_cell_text(cell, shared_strings)

        if not values_by_index:
            rows.append([])
            continue

        width = max(values_by_index) + 1
        row_values = [values_by_index.get(index, '') for index in range(width)]
        while row_values and row_values[-1] == '':
            row_values.pop()
        rows.append(row_values)

    while rows and not any(rows[-1]):
        rows.pop()
    return rows


def escape_csv_value(value: str) -> str:
    return (
        value.replace('\\', '\\\\')
        .replace('\r\n', '\n')
        .replace('\r', '\n')
        .replace('\n', '\\n')
        .replace('\t', '\\t')
    )


def slugify_sheet_name(sheet_name: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '_', sheet_name.lower()).strip('_')
    return slug or 'sheet'


def write_sheet_exports(workbook_path: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    for pattern in ('*.csv', '*.tsv'):
        for existing in output_dir.glob(pattern):
            existing.unlink()

    with ZipFile(workbook_path) as archive:
        shared_strings = read_shared_strings(archive)
        sheets = read_workbook_sheets(archive)
        written_files: list[Path] = []

        for index, (sheet_name, sheet_path) in enumerate(sheets, start=1):
            rows = read_sheet_rows(archive, sheet_path, shared_strings)
            file_path = output_dir / f'{index:02d}_{slugify_sheet_name(sheet_name)}.csv'
            with file_path.open('w', encoding='utf-8', newline='') as handle:
                writer = csv.writer(handle, lineterminator='\n')
                for row in rows:
                    writer.writerow([escape_csv_value(value) for value in row])
            written_files.append(file_path)

    return written_files


def main() -> int:
    args = parse_args()
    workbook_path = Path(args.workbook)
    output_dir = Path(args.output)

    if not workbook_path.exists():
        raise SystemExit(f'Workbook not found: {workbook_path}')

    written_files = write_sheet_exports(workbook_path, output_dir)
    print(f'Exported {len(written_files)} sheet(s) from {workbook_path} to {output_dir}.')
    for file_path in written_files:
        print(f'- {file_path.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
