"""
sheets_editor.py — Google Sheets batch editor for travel_planner.

Usage from Claude Code (interactive):
  python3 scripts/sheets_editor.py

Functions available for Claude Code to call:
  add_row(sheet_type, fields)
  update_row(sheet_type, key_fields, new_fields)
  delete_row(sheet_type, key_fields)
  replace_day(date_str, new_rows_list)
  format_sheet(sheet_type)
  sort_sheet(sheet_type)
  show_sheet(sheet_type)

sheet_type: 'travel' | 'reference' | 'important'
"""

import os
from dotenv import load_dotenv

import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

load_dotenv(os.path.expanduser('~/.config/travel_planner/.env'))

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

GID_KEYS = {
    'travel':    'TRAVEL_SHEET_GID',
    'reference': 'REFERENCE_SHEET_GID',
    'important': 'IMPORTANT_INFO_SHEET_GID',
}

SORT_KEYS = {
    'travel':    ['日期', '時間'],
    'reference': ['類別', '名稱'],
    'important': ['category', 'title'],
}

HEADER_COLORS = {
    'travel':    '#1F4E79',
    'reference': '#1E4620',
    'important': '#1E4620',
}

LIGHT_COLORS = {
    'travel':    '#E8F0FE',
    'reference': '#E8F5E9',
    'important': '#E8F5E9',
}

GROUP_COL = {
    'travel':    '日期',
    'reference': '類別',
    'important': 'category',
}


def _get_creds():
    sa_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not sa_path:
        raise ValueError('GOOGLE_SERVICE_ACCOUNT_JSON not set in .env')
    return Credentials.from_service_account_file(sa_path, scopes=SCOPES)


def _get_gc():
    return gspread.Client(auth=_get_creds())


def get_sheet(sheet_type):
    """Return the gspread Worksheet for the given sheet_type."""
    if sheet_type not in GID_KEYS:
        raise ValueError(f'Unknown sheet_type: {sheet_type}. Use: travel, reference, important')
    gc = _get_gc()
    sheet_id = os.getenv('SHEET_ID')
    if not sheet_id:
        raise ValueError('SHEET_ID not set in .env')
    ss = gc.open_by_key(sheet_id)
    gid = os.getenv(GID_KEYS[sheet_type])
    if not gid:
        raise ValueError(f'{GID_KEYS[sheet_type]} not set in .env')
    for ws in ss.worksheets():
        if str(ws.id) == gid:
            return ws
    raise ValueError(f'Sheet tab not found for GID={gid}')


def show_sheet(sheet_type):
    """Print current sheet contents to console."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if not data:
        print(f'[{sheet_type}] Empty sheet')
        return
    headers = data[0]
    print(f'\n[{sheet_type}] {len(data)-1} rows')
    print(' | '.join(headers))
    print('-' * 80)
    for row in data[1:]:
        print(' | '.join(str(v) for v in row[:6]))  # show first 6 cols


def add_row(sheet_type, fields):
    """Append a new row, then sort and format the sheet.

    Args:
        sheet_type: 'travel' | 'reference' | 'important'
        fields: dict mapping column headers to values
                e.g. {'日期': '2026/03/07', '時間': '14:00', ...}
    """
    ws = get_sheet(sheet_type)
    headers = ws.row_values(1)
    row = [fields.get(h, '') for h in headers]
    ws.append_row(row, value_input_option='USER_ENTERED')
    sort_sheet(sheet_type)
    format_sheet(sheet_type)
    print(f'✅ Added to {sheet_type}')


def update_row(sheet_type, key_fields, new_fields):
    """Find a row by key_fields and update new_fields.

    Args:
        key_fields: dict to identify the row, e.g. {'日期': '2026/03/07', '時間': '14:00'}
        new_fields: dict of fields to update, e.g. {'活動標題': '嚴島神社'}
    """
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 2:
        raise ValueError(f'{sheet_type} sheet has no data rows')
    headers = data[0]

    unknown_keys = [k for k in key_fields if k not in headers]
    if unknown_keys:
        raise ValueError(f'Unknown key column(s) in update_row: {unknown_keys}. Available: {headers}')

    row_idx = None
    for i, row in enumerate(data[1:], start=2):
        match = all(row[headers.index(k)] == v for k, v in key_fields.items())
        if match:
            row_idx = i
            break

    if row_idx is None:
        raise ValueError(f'Row not found matching {key_fields}')

    unknown_new = [k for k in new_fields if k not in headers]
    if unknown_new:
        raise ValueError(f'Unknown field(s) in new_fields: {unknown_new}. Available: {headers}')

    existing = list(data[row_idx - 1])
    for field, value in new_fields.items():
        existing[headers.index(field)] = value

    ws.update(f'A{row_idx}', [existing], value_input_option='USER_ENTERED')
    format_sheet(sheet_type)
    print(f'✅ Updated row {row_idx} in {sheet_type}')


def delete_row(sheet_type, key_fields):
    """Find a row by key_fields and delete it.

    Args:
        key_fields: dict to identify the row, e.g. {'日期': '2026/03/07', '時間': '14:00'}
    """
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 2:
        raise ValueError(f'{sheet_type} sheet has no data rows')
    headers = data[0]

    unknown_keys = [k for k in key_fields if k not in headers]
    if unknown_keys:
        raise ValueError(f'Unknown key column(s) in delete_row: {unknown_keys}. Available: {headers}')

    row_idx = None
    for i, row in enumerate(data[1:], start=2):
        match = all(row[headers.index(k)] == v for k, v in key_fields.items())
        if match:
            row_idx = i
            break

    if row_idx is None:
        raise ValueError(f'Row not found matching {key_fields}')

    ws.delete_rows(row_idx)
    format_sheet(sheet_type)
    print(f'✅ Deleted row {row_idx} from {sheet_type}')


def replace_day(date_str, new_rows_list):
    """Delete all Travel rows for date_str and insert new_rows_list.

    Args:
        date_str: e.g. '2026/03/07'
        new_rows_list: list of dicts, each dict = one row's fields
                       e.g. [{'日期': '2026/03/07', '時間': '09:00', ...}, ...]
    """
    ws = get_sheet('travel')
    data = ws.get_all_values()
    if not data:
        raise ValueError('Travel sheet is empty')
    headers = data[0]
    date_idx = headers.index('日期') if '日期' in headers else 0

    # Collect row indices (1-indexed) for this date, bottom-up
    rows_to_delete = [
        i + 2
        for i, row in enumerate(data[1:])
        if row[date_idx] == date_str
    ]

    for row_idx in reversed(rows_to_delete):
        ws.delete_rows(row_idx)

    # Append new rows
    if new_rows_list:
        to_append = []
        for fields in new_rows_list:
            row = [fields.get(h, '') for h in headers]
            to_append.append(row)
        ws.append_rows(to_append, value_input_option='USER_ENTERED')

    sort_sheet('travel')
    format_sheet('travel')
    print(f'✅ Replaced {len(rows_to_delete)} rows for {date_str} → {len(new_rows_list)} new rows')


def sort_sheet(sheet_type):
    """Sort data rows by key columns. Called automatically by add_row/replace_day."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 3:
        return  # header + <2 rows → nothing to sort

    headers = data[0]
    rows = data[1:]
    key_cols = SORT_KEYS.get(sheet_type, [])
    key_indices = [headers.index(k) for k in key_cols if k in headers]

    if key_indices:
        rows.sort(key=lambda r: tuple(r[i] if i < len(r) else '' for i in key_indices))

    # Clear data area and rewrite sorted rows (use large constant to cover all existing rows)
    total = len(rows)
    ws.batch_clear(['A2:ZZ10000'])
    if rows:
        ws.update('A2', rows, value_input_option='USER_ENTERED')
    print(f'  ↳ sorted {total} rows in {sheet_type}')


def _hex_to_rgb(hex_color):
    """Convert #RRGGBB → {red, green, blue} with 0–1 float values."""
    h = hex_color.lstrip('#')
    return {
        'red':   int(h[0:2], 16) / 255,
        'green': int(h[2:4], 16) / 255,
        'blue':  int(h[4:6], 16) / 255,
    }


def format_sheet(sheet_type):
    """Apply header color + alternating row colors to the sheet."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if not data:
        return

    worksheet_id = ws.id
    spreadsheet_id = os.getenv('SHEET_ID')
    service = build('sheets', 'v4', credentials=_get_creds())

    headers = data[0]
    num_cols = len(headers)
    header_bg = HEADER_COLORS[sheet_type]
    light_color = LIGHT_COLORS[sheet_type]
    group_col_name = GROUP_COL[sheet_type]
    group_col_idx = headers.index(group_col_name) if group_col_name in headers else 0

    requests = []

    # ── Header row (row index 0 = row 1 in Sheets) ──
    requests.append({
        'repeatCell': {
            'range': {
                'sheetId': worksheet_id,
                'startRowIndex': 0,
                'endRowIndex': 1,
                'startColumnIndex': 0,
                'endColumnIndex': num_cols,
            },
            'cell': {
                'userEnteredFormat': {
                    'backgroundColor': _hex_to_rgb(header_bg),
                    'textFormat': {
                        'foregroundColor': _hex_to_rgb('#FFFFFF'),
                        'bold': True,
                    }
                }
            },
            'fields': 'userEnteredFormat(backgroundColor,textFormat)',
        }
    })

    # ── Data rows: alternating by group ──
    if len(data) > 1:
        group_idx = -1
        last_group = None

        for i, row in enumerate(data[1:]):
            row_0idx = i + 1  # 0-indexed sheet row
            group_val = row[group_col_idx] if group_col_idx < len(row) else ''
            if group_val and group_val != last_group:
                last_group = group_val
                group_idx += 1

            bg = '#FFFFFF' if group_idx % 2 == 0 else light_color
            requests.append({
                'repeatCell': {
                    'range': {
                        'sheetId': worksheet_id,
                        'startRowIndex': row_0idx,
                        'endRowIndex': row_0idx + 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': num_cols,
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': _hex_to_rgb(bg)
                        }
                    },
                    'fields': 'userEnteredFormat.backgroundColor',
                }
            })

    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'requests': requests}
    ).execute()
    print(f'  ↳ formatted {sheet_type} ({len(data)-1} data rows)')
