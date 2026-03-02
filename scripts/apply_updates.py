"""
apply_updates.py — Batch apply pending_updates.json to Google Sheets.

Usage:
  python3 scripts/apply_updates.py              # surgical update (default)
  python3 scripts/apply_updates.py --sort       # full rewrite + sort (with backup)
  python3 scripts/apply_updates.py --dry-run    # preview only, no write
  python3 scripts/apply_updates.py --restore backups/latest.json

Fixed cost: 2 API calls regardless of operation count.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
import gspread

load_dotenv(os.path.expanduser('~/.config/travel_planner/.env'))

PENDING_FILE = Path('data/pending_updates.json')
BACKUP_FILE  = Path('backups/latest.json')
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


# ── Connection (single per run) ──────────────────────────────────────────────

def _get_creds():
    sa_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not sa_path:
        raise ValueError('GOOGLE_SERVICE_ACCOUNT_JSON not set in .env')
    return Credentials.from_service_account_file(sa_path, scopes=SCOPES)


def _connect(sheet_type):
    """Return (ws, service, spreadsheet_id) tuple. Called once."""
    creds = _get_creds()
    gc = gspread.Client(auth=creds)
    sheet_id = os.getenv('SHEET_ID')
    if not sheet_id:
        raise ValueError('SHEET_ID not set in .env')
    ss = gc.open_by_key(sheet_id)
    gid = os.getenv(GID_KEYS[sheet_type])
    if not gid:
        raise ValueError(f'{GID_KEYS[sheet_type]} not set in .env')
    for ws in ss.worksheets():
        if str(ws.id) == gid:
            service = build('sheets', 'v4', credentials=creds)
            return ws, service, sheet_id
    raise ValueError(f'Sheet tab not found for GID={gid}')


# ── Helpers ──────────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_color):
    h = hex_color.lstrip('#')
    return {
        'red':   int(h[0:2], 16) / 255,
        'green': int(h[2:4], 16) / 255,
        'blue':  int(h[4:6], 16) / 255,
    }


def _load_pending():
    if not PENDING_FILE.exists():
        print(f'❌ {PENDING_FILE} not found')
        sys.exit(1)
    with open(PENDING_FILE, encoding='utf-8') as f:
        return json.load(f)


def _save_backup(data):
    BACKUP_FILE.parent.mkdir(exist_ok=True)
    with open(BACKUP_FILE, 'w', encoding='utf-8') as f:
        json.dump({'saved_at': datetime.now().isoformat(), 'data': data}, f, ensure_ascii=False, indent=2)
    print(f'  ↳ backup saved → {BACKUP_FILE}')


def _sort_rows(rows, headers, sheet_type):
    key_cols = SORT_KEYS.get(sheet_type, [])
    key_indices = [headers.index(k) for k in key_cols if k in headers]
    if key_indices:
        rows.sort(key=lambda r: tuple(r[i] if i < len(r) else '' for i in key_indices))
    return rows


def _build_format_requests(ws_id, headers, rows, sheet_type):
    """Build formatting requests for header + alternating row colors."""
    num_cols = len(headers)
    header_bg = HEADER_COLORS[sheet_type]
    light_color = LIGHT_COLORS[sheet_type]
    group_col_name = GROUP_COL[sheet_type]
    group_col_idx = headers.index(group_col_name) if group_col_name in headers else 0

    requests = []

    # Header row
    requests.append({
        'repeatCell': {
            'range': {
                'sheetId': ws_id,
                'startRowIndex': 0, 'endRowIndex': 1,
                'startColumnIndex': 0, 'endColumnIndex': num_cols,
            },
            'cell': {
                'userEnteredFormat': {
                    'backgroundColor': _hex_to_rgb(header_bg),
                    'textFormat': {'foregroundColor': _hex_to_rgb('#FFFFFF'), 'bold': True},
                }
            },
            'fields': 'userEnteredFormat(backgroundColor,textFormat)',
        }
    })

    # Alternating data rows by group
    group_idx = -1
    last_group = None
    for i, row in enumerate(rows):
        row_0idx = i + 1
        group_val = row[group_col_idx] if group_col_idx < len(row) else ''
        if group_val and group_val != last_group:
            last_group = group_val
            group_idx += 1
        bg = '#FFFFFF' if group_idx % 2 == 0 else light_color
        requests.append({
            'repeatCell': {
                'range': {
                    'sheetId': ws_id,
                    'startRowIndex': row_0idx, 'endRowIndex': row_0idx + 1,
                    'startColumnIndex': 0, 'endColumnIndex': num_cols,
                },
                'cell': {'userEnteredFormat': {'backgroundColor': _hex_to_rgb(bg)}},
                'fields': 'userEnteredFormat.backgroundColor',
            }
        })
    return requests


# ── Modes (stubs — implemented in Tasks 5–8) ─────────────────────────────────

def do_surgical_update(pending, dry_run=False):
    """Apply operations surgically without destroying row styles."""
    sheet_type = pending.get('sheet_type', 'travel')
    operations = pending.get('operations', [])

    ws, service, sheet_id = _connect(sheet_type)
    # Call 1: Read
    data = ws.get_all_values()
    if not data:
        print('❌ Sheet is empty')
        return
    headers = data[0]
    rows = [list(r) for r in data[1:]]

    def find_row(key_fields):
        for i, row in enumerate(rows):
            if all(
                (row[headers.index(k)] if headers.index(k) < len(row) else '') == str(v)
                for k, v in key_fields.items()
                if k in headers
            ):
                return i
        return None

    delete_indices = set()
    insertions = {}  # { int idx -> list[list[str]] }
    updates = {}     # { int idx -> list[str] }
    additions = []   # list[list[str]]

    for op in operations:
        kind = op.get('op')

        if kind == 'update':
            idx = find_row(op['key'])
            if idx is not None:
                if idx not in updates:
                    updates[idx] = list(rows[idx])
                for field, val in op['fields'].items():
                    if field in headers:
                        updates[idx][headers.index(field)] = str(val)

        elif kind == 'add':
            additions.append([str(op['fields'].get(h, '')) for h in headers])

        elif kind == 'delete':
            idx = find_row(op['key'])
            if idx is not None:
                delete_indices.add(idx)

        elif kind == 'replace_day':
            date_str = op['date']
            if '日期' not in headers:
                raise ValueError("Sheet missing '日期' column")
            date_idx = headers.index('日期')
            
            day_indices = [i for i, row in enumerate(rows) if (row[date_idx] if date_idx < len(row) else '') == date_str]
            insert_idx = len(rows)
            if day_indices:
                insert_idx = min(day_indices)
                for i in day_indices:
                    delete_indices.add(i)
            
            new_rows = []
            for fields in op.get('rows', []):
                new_rows.append([str(fields.get(h, '')) for h in headers])
            if new_rows:
                insertions.setdefault(insert_idx, []).extend(new_rows)

    if additions:
        insertions.setdefault(len(rows), []).extend(additions)

    # Compute explicit new_sheet elements purely for data mapping
    new_sheet = []
    for i in range(len(rows) + 1):
        if i in insertions:
            for r in insertions[i]:
                new_sheet.append({'type': 'insert', 'data': r})
        if i < len(rows):
            if i not in delete_indices:
                row_data = updates.get(i, rows[i])
                needs_write = (i in updates)
                new_sheet.append({'type': 'keep', 'data': row_data, 'needs_write': needs_write})

    if dry_run:
        inserts_count = sum(len(x) for x in insertions.values())
        print(f'[dry-run] Would update {len(updates)} rows, delete {len(delete_indices)}, insert {inserts_count}')
        return

    # Call 2: Architecture updates (bottom-up dimension shifts preserving formats)
    ws_id = ws.id
    dimension_requests = []
    
    for i in range(len(rows), -1, -1):
        sheet_row_0idx = i + 1  # 0 is header, rows[0] is data line at index 1
        
        # 1. Delete dimension
        if i in delete_indices:
            dimension_requests.append({
                'deleteDimension': {
                    'range': {
                        'sheetId': ws_id,
                        'dimension': 'ROWS',
                        'startIndex': sheet_row_0idx,
                        'endIndex': sheet_row_0idx + 1
                    }
                }
            })
            
        # 2. Insert dimension
        if i in insertions:
            num_inserts = len(insertions[i])
            dimension_requests.append({
                'insertDimension': {
                    'range': {
                        'sheetId': ws_id,
                        'dimension': 'ROWS',
                        'startIndex': sheet_row_0idx,
                        'endIndex': sheet_row_0idx + num_inserts
                    },
                    'inheritFromBefore': (sheet_row_0idx > 1)
                }
            })

    if dimension_requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={'requests': dimension_requests}
        ).execute()

    # Build ranges for pure value writes via USER_ENTERED type-inference
    write_ranges = []
    current_start = None
    current_rows = []

    for j, item in enumerate(new_sheet):
        if item['type'] == 'insert' or item.get('needs_write'):
            if current_start is None:
                current_start = j
            current_rows.append(item['data'])
        else:
            if current_start is not None:
                write_ranges.append((current_start, current_rows))
                current_start = None
                current_rows = []
    if current_start is not None:
        write_ranges.append((current_start, current_rows))

    if not dimension_requests and not write_ranges:
        print('ℹ️  No changes to apply')
        return

    # Call 3: Data writes
    if write_ranges:
        data_value_ranges = []
        for start_j, row_bunch in write_ranges:
            sheet_row_1idx = start_j + 2  # j=0 -> data row 0 -> sheet element 2
            range_a1 = f"'{ws.title}'!A{sheet_row_1idx}"
            data_value_ranges.append({
                'range': range_a1,
                'values': row_bunch
            })
            
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={
                'valueInputOption': 'USER_ENTERED',
                'data': data_value_ranges
            }
        ).execute()

    inserts_count = sum(len(x) for x in insertions.values())
    print(f'✅ Applied: {len(updates)} updated, {len(delete_indices)} deleted, {inserts_count} inserted')
    print(f'   API calls: 1 Read, 1 Layout Shift, 1 Value Write')

    # Archive pending file
    PENDING_FILE.rename(PENDING_FILE.with_suffix('.applied.json'))


def do_full_rewrite_with_sort(pending, dry_run=False):
    """Full table rewrite with sort. Saves backup first."""
    sheet_type = pending.get('sheet_type', 'travel')
    operations = pending.get('operations', [])

    ws, service, sheet_id = _connect(sheet_type)
    # Call 1: Read
    data = ws.get_all_values()
    if not data:
        print('❌ Sheet is empty')
        return
    headers = data[0]
    rows = [list(r) for r in data[1:]]

    # Save backup before any write
    if not dry_run:
        _save_backup(data)

    # Apply all operations in memory (same logic as surgical)
    def find_row(key_fields):
        for i, row in enumerate(rows):
            if all(
                (row[headers.index(k)] if headers.index(k) < len(row) else '') == v
                for k, v in key_fields.items()
                if k in headers
            ):
                return i
        return None

    rows_to_delete = set()
    for op in operations:
        kind = op.get('op')
        if kind == 'update':
            idx = find_row(op['key'])
            if idx is not None:
                for field, val in op['fields'].items():
                    if field in headers:
                        rows[idx][headers.index(field)] = val
        elif kind == 'add':
            rows.append([op['fields'].get(h, '') for h in headers])
        elif kind == 'delete':
            idx = find_row(op['key'])
            if idx is not None:
                rows_to_delete.add(idx)
        elif kind == 'replace_day':
            date_str = op['date']
            date_idx = headers.index('日期') if '日期' in headers else 0
            for i, row in enumerate(rows):
                if (row[date_idx] if date_idx < len(row) else '') == date_str:
                    rows_to_delete.add(i)
            for fields in op.get('rows', []):
                rows.append([fields.get(h, '') for h in headers])

    rows = [r for i, r in enumerate(rows) if i not in rows_to_delete]

    # Sort
    rows = _sort_rows(rows, headers, sheet_type)

    if dry_run:
        print(f'[dry-run] Would rewrite {len(rows)} rows (sorted)')
        return

    ws_id = ws.id
    current_row_count = len(data)

    requests = []
    if current_row_count > 1:
        requests.append({
            'deleteDimension': {
                'range': {
                    'sheetId': ws_id,
                    'dimension': 'ROWS',
                    'startIndex': 1,
                    'endIndex': current_row_count,
                }
            }
        })

    if rows:
        requests.append({
            'insertDimension': {
                'range': {
                    'sheetId': ws_id,
                    'dimension': 'ROWS',
                    'startIndex': 1,
                    'endIndex': 1 + len(rows)
                },
                'inheritFromBefore': False
            }
        })

    # Provide explicit grid formatting requests (header/alternating)
    requests.extend(_build_format_requests(ws_id, headers, rows, sheet_type))

    # Call 2: Architecture Wipe + Format
    service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={'requests': requests}
    ).execute()

    # Call 3: Value Dump with USER_ENTERED
    if rows:
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={
                'valueInputOption': 'USER_ENTERED',
                'data': [{
                    'range': f"'{ws.title}'!A2",
                    'values': rows
                }]
            }
        ).execute()

    print(f'✅ Full rewrite: {len(rows)} rows sorted by {SORT_KEYS.get(sheet_type)}')
    print(f'   API calls: 1 Read, 1 Layout/Format, 1 Value Write')

    # Archive pending file
    PENDING_FILE.rename(PENDING_FILE.with_suffix('.applied.json'))


def do_restore(backup_path):
    """Restore sheet from local backup JSON."""
    path = Path(backup_path)
    if not path.exists():
        print(f'❌ Backup file not found: {backup_path}')
        sys.exit(1)

    with open(path, encoding='utf-8') as f:
        backup = json.load(f)

    saved_at = backup.get('saved_at', 'unknown')
    data = backup.get('data', [])
    if not data:
        print('❌ Backup is empty')
        sys.exit(1)

    headers = data[0]
    # Infer sheet_type from first column header
    sheet_type = 'travel'  # default; backup could store this

    print(f'Restoring {len(data)-1} rows from backup saved at {saved_at}...')

    ws, service, sheet_id = _connect(sheet_type)
    ws_id = ws.id

    # Call 1: Read current row count
    current = ws.get_all_values()
    current_count = len(current)

    requests = []
    if current_count > 1:
        requests.append({
            'deleteDimension': {
                'range': {
                    'sheetId': ws_id,
                    'dimension': 'ROWS',
                    'startIndex': 1,
                    'endIndex': current_count,
                }
            }
        })

    rows = data[1:]
    if rows:
        requests.append({
            'insertDimension': {
                'range': {
                    'sheetId': ws_id,
                    'dimension': 'ROWS',
                    'startIndex': 1,
                    'endIndex': 1 + len(rows)
                },
                'inheritFromBefore': False
            }
        })

    service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={'requests': requests}
    ).execute()
    
    if rows:
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={
                'valueInputOption': 'USER_ENTERED',
                'data': [{
                    'range': f"'{ws.title}'!A2",
                    'values': rows
                }]
            }
        ).execute()

    print(f'✅ Restored {len(rows)} rows from {backup_path}')
    print(f'   API calls: 1 Read, 1 Layout, 1 Value Write')


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Apply pending_updates.json to Google Sheets')
    parser.add_argument('--sort',    action='store_true', help='Full rewrite + sort (with backup)')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, no write')
    parser.add_argument('--restore', type=str,            help='Restore from backup file path')
    args = parser.parse_args()

    if args.restore:
        do_restore(args.restore)
    elif args.sort:
        pending = _load_pending()
        do_full_rewrite_with_sort(pending, dry_run=args.dry_run)
    else:
        pending = _load_pending()
        do_surgical_update(pending, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
