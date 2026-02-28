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
    """Apply only specified operations. Untouched rows are never modified."""
    sheet_type = pending.get('sheet_type', 'travel')
    operations = pending.get('operations', [])

    ws, service, sheet_id = _connect(sheet_type)
    # Call 1: Read
    data = ws.get_all_values()
    if not data:
        print('❌ Sheet is empty')
        return
    headers = data[0]
    rows = [list(r) for r in data[1:]]  # mutable copies

    def find_row(key_fields):
        for i, row in enumerate(rows):
            if all(
                (row[headers.index(k)] if headers.index(k) < len(row) else '') == v
                for k, v in key_fields.items()
                if k in headers
            ):
                return i
        return None

    # Process operations in memory
    delete_indices = set()
    update_ops = set()  # deduplicated row indices
    append_rows = []

    for op in operations:
        kind = op.get('op')

        if kind == 'update':
            idx = find_row(op['key'])
            if idx is None:
                print(f'⚠️  Row not found for update: {op["key"]}')
                continue
            for field, val in op['fields'].items():
                if field in headers:
                    rows[idx][headers.index(field)] = val
            update_ops.add(idx)

        elif kind == 'add':
            new_row = [op['fields'].get(h, '') for h in headers]
            append_rows.append(new_row)

        elif kind == 'delete':
            idx = find_row(op['key'])
            if idx is None:
                print(f'⚠️  Row not found for delete: {op["key"]}')
                continue
            delete_indices.add(idx)

        elif kind == 'replace_day':
            date_str = op['date']
            if '日期' not in headers:
                raise ValueError("Sheet missing '日期' column")
            date_idx = headers.index('日期')
            for i, row in enumerate(rows):
                if (row[date_idx] if date_idx < len(row) else '') == date_str:
                    delete_indices.add(i)
            for fields in op.get('rows', []):
                append_rows.append([fields.get(h, '') for h in headers])

    if dry_run:
        print(f'[dry-run] Would update {len(update_ops)} rows, delete {len(delete_indices)}, add {len(append_rows)}')
        return

    # Build batchUpdate requests
    requests = []
    ws_id = ws.id

    # update_ops is a deduplicated set of row indices to rewrite
    # Update specific rows (must come before deletes to keep row indices stable)
    for idx in update_ops:
        if idx in delete_indices:
            continue
        sheet_row = idx + 1
        row_values = [{'userEnteredValue': {'stringValue': str(v)}} for v in rows[idx]]
        requests.append({
            'updateCells': {
                'range': {
                    'sheetId': ws_id,
                    'startRowIndex': sheet_row,
                    'endRowIndex': sheet_row + 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': len(rows[idx]),
                },
                'rows': [{'values': row_values}],
                'fields': 'userEnteredValue',
            }
        })

    # Delete rows (reverse order to avoid index shift)
    for idx in sorted(delete_indices, reverse=True):
        sheet_row = idx + 1  # 0-indexed data → 1-indexed (skip header)
        requests.append({
            'deleteDimension': {
                'range': {
                    'sheetId': ws_id,
                    'dimension': 'ROWS',
                    'startIndex': sheet_row,
                    'endIndex': sheet_row + 1,
                }
            }
        })

    # Append new rows
    if append_rows:
        append_row_data = []
        for row in append_rows:
            append_row_data.append({
                'values': [{'userEnteredValue': {'stringValue': str(v)}} for v in row]
            })
        requests.append({
            'appendCells': {
                'sheetId': ws_id,
                'rows': append_row_data,
                'fields': 'userEnteredValue',
            }
        })

    if not requests:
        print('ℹ️  No changes to apply')
        return

    # Call 2: Write (all operations in one batchUpdate)
    service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={'requests': requests}
    ).execute()

    print(f'✅ Applied: {len(update_ops)} updated, {len(delete_indices)} deleted, {len(append_rows)} added')
    print(f'   2 API calls total')

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
    current_row_count = len(data)  # includes header

    # Build single batchUpdate: delete old data rows + append new sorted rows + format
    requests = []

    # Delete all existing data rows (keep header at index 0)
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

    # Append sorted rows (values only)
    if rows:
        append_row_data = []
        for row in rows:
            append_row_data.append({
                'values': [{'userEnteredValue': {'stringValue': str(v)}} for v in row]
            })
        requests.append({
            'appendCells': {
                'sheetId': ws_id,
                'rows': append_row_data,
                'fields': 'userEnteredValue',
            }
        })

    # Formatting (header + alternating rows)
    requests.extend(_build_format_requests(ws_id, headers, rows, sheet_type))

    # Call 2: Write everything (data + format) in one batchUpdate
    service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={'requests': requests}
    ).execute()

    print(f'✅ Full rewrite: {len(rows)} rows sorted by {SORT_KEYS[sheet_type]}')
    print(f'   2 API calls total')

    # Archive pending file
    PENDING_FILE.rename(PENDING_FILE.with_suffix('.applied.json'))


def do_restore(backup_path):
    raise NotImplementedError('Task 7')


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
