# Lab Component Inventory Manager

**Purpose**: Lab parts tracking system with usage tracking, real-count reconciliation, and suggested parts workflow.

## AI-Assisted Development

Offload self-contained generation to local Ollama (`qwen2.5-coder:7b`). Use the HTTP API,
not `ollama run` — the CLI emits TTY escape codes on a pipe, and cleaning them out of the
transcript costs more context than the answer is worth.

```powershell
(Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -ContentType "application/json" `
  -Body '{"model":"qwen2.5-coder:7b","prompt":"<prompt>","stream":false}').response
```

**Delegate to Ollama** when the task needs no knowledge of this codebase: a standalone
snippet, a regex, a format conversion, boilerplate.

**Keep on Claude** when the task depends on what's already here — file edits, debugging,
multi-file changes, and anything touching the take/return deltas, report-matching, or the
audit log. Briefing Ollama on that context costs more than doing the work.

Rule of thumb: if explaining the task to Ollama is longer than the answer, don't delegate it.

Prefer Ponytail principles throughout: minimal code, stdlib, no over-engineering.


## Stack
- **Frontend**: React 19, Vite (port 5173)
- **Backend**: Express 5, node:sqlite (stdlib, needs Node 22.9+) (port 3001)
- **Database**: SQLite (components.db)

## Database Schema
```
components: inventory_key (PK), name, category, package, in_stock, location, manufacturer_nr
categories: id, name (UNIQUE)
packages: id, name (UNIQUE)
locations: id, main, secondary, UNIQUE(main, secondary)   <- the main->secondary relation list
suggested_components: inventory_key (PK), name, category, package, in_stock, location, manufacturer_nr, created_at
real_number_reports: id, inventory_key (FK), reported_number, timestamp
reports: id, inventory_key (FK), report_type, timestamp
```

## Features

### 1. Component Management
- Add components (auto-generates 9-char inventory key via Math.random().toString(36).substr(2,9))
- View/search components, filter by category
- Toggle zero-stock visibility

### 1a. Sorting
- One control next to the category filter: **Name A–Z** / **Name Z–A**
- Rows always group by category first, package second; the choice only flips the name
  direction inside a group. Applies to the suggested rows too.
- Compare is natural and case-insensitive, so "22 Ohm 1%" sorts before "100 Ohm 1%"
  and lowercase `resistor` groups alongside `Flux`/`Soldering paste`
- Known gap: this sorts by *name*, not by resistance. "1k5 Ohm 1%" lands before
  "18 Ohm 1%" because 1 < 18 as a number in the name. A true value sort would need to
  parse engineering notation (1k5 -> 1500).

### 1b. Location Entry
- Two dependent dropdowns: main location, then secondary (shelf) filtered to that main
- Stored and displayed as one string: `Regal 1 - Shelve 1`
- New pairs added inline, same as categories/packages. A main containing ` - ` is rejected,
  since that would make the display string ambiguous to split back apart.
- Pre-existing free-text locations still display as-is; they read back as main-only

### 1c. Right-Click Menu (Edit / Copy)
- Right-click any row on the main page for a two-item menu: **Edit** and **Copy**

**Edit** turns the row into inputs in place:
- Editable: name, category, package, in_stock, location, manufacturer_nr
- `inventory_key` is never editable: it is the identity and the FK that `reports` and
  `real_number_reports` hang off, so edits keep all report history attached
- Admin sees **Save** (writes immediately via PUT). Everyone else sees **Suggest**,
  which files the edited values into `suggested_components` and goes through the normal
  approve/reject queue

**Copy** opens the normal add-component form with every field prefilled from the copied
part except `inventory_key`, which is generated fresh — saving it would otherwise collide
with the part being copied. Save/Suggest then behave exactly as for a hand-typed part.

### 2. Usage Tracking (Take/Return)
- "Use" button → modal for amount
- Take: subtracts from in_stock (min 0), also updates ALL real_number_reports for this key by -amount
- Return: adds to in_stock, also updates ALL real_number_reports for this key by +amount

### 3. Real Number Reporting
- "Report Real Number" in Report dropdown
- Matching logic: COUNT real_number_reports WHERE inventory_key=X AND reported_number=new_value
  - If count ≥ 1 (2nd+ report of same value): UPDATE in_stock=value, DELETE all reports for key, log REPORT_REAL_MATCH
  - Else: INSERT new report, log REPORT_REAL_NEW

### 4. Auto-Zero on Missing Reports
- 2+ "Not in stock" reports for same component → set in_stock=0, log AUTO_ZERO

### 5. Suggested Parts
- Suggest button → saves to suggested_components
- Save button requires the admin password (`ADMIN_PASSWORD` in `.env`)
- Toggle "Show Suggested Parts" checkbox to display (yellow highlight)

### 6. Audit Logging
- All DB changes logged to /logs/database.log
- Format: YYYY-MM-DD HH:MM:SS | EVENT_TYPE | key=val | key=val | ...
- Events: USE_ACTION, REPORT_REAL_NEW, REPORT_REAL_MATCH, AUTO_ZERO, REPORT_ADDED

## API (all HTTP)

Routes marked 🔒 require header `x-admin-password`. The password comes from
`ADMIN_PASSWORD` in `.env`; the server refuses to start without it. Everyday lab actions — use/take/return,
reporting, suggesting, adding categories and packages — are deliberately open;
gating them would defeat the point of the tool.

| Method | Endpoint | Params/Body | Response |
|--------|----------|------------|----------|
| GET | /api/components | search, category | [{inventory_key, name, ...}] |
| GET | /api/admin/check | 🔒 — | {ok: true} \| 401 |
| GET | /api/reports | 🔒 — | [{id, inventory_key, name, report_type, timestamp}] |
| POST | /api/components | 🔒 {inventory_key, name, category, package, in_stock, location, manufacturer_nr} | {success: true} |
| PUT | /api/components/:key | 🔒 {name, category, package, in_stock, location, manufacturer_nr} | {success: true} \| 400 \| 404 |
| DELETE | /api/components/:key | 🔒 — | {success: true} |
| POST | /api/components/:key/use | {amount, action: "take"\|"return"} | {success: true, in_stock: N} |
| POST | /api/components/:key/report-real | {reported_number: INT} | {success: true} |
| GET | /api/categories | — | [{id, name}] |
| POST | /api/categories | {name} | {success: true} |
| GET | /api/packages | — | [{id, name}] |
| POST | /api/packages | {name} | {success: true} |
| GET | /api/locations | — | [{id, main, secondary}] |
| POST | /api/locations | {main, secondary} | {success: true} \| 400 |
| GET | /api/suggested_components | — | [{inventory_key, name, ...}] |
| POST | /api/suggested_components | {inventory_key, name, ...} | {success: true} |
| DELETE | /api/suggested_components/:key | 🔒 — | {success: true} |
| POST | /api/suggested_components/:key/approve | 🔒 — | {success: true} \| 404 |
| POST | /api/reports | {inventory_key, report_type} | {success: true} |

## Run
```bash
npm install
cp .env.example .env   # then set ADMIN_PASSWORD
npm run server    # port 3001
npm run dev       # port 5173
```

## Tests
```bash
node test_admin.js   # admin gate, approve flow, reports endpoint, delete cascade
node test_views.js   # admin view filters (out / low threshold / suggested / all)
node test_locations.js  # location split/join round-trip
node test_sort.js       # category/package grouping + A-Z/Z-A name direction
```

## Critical Logic

**Deleting a component** cascades: `reports` and `real_number_reports` both hold a
FK to `components`, so those rows are removed in the same transaction. Without
this the delete fails with `FOREIGN KEY constraint failed` for any part that was
ever reported. The permanent history stays in `logs/database.log`.

**Real Number Matching**: When report arrives with value V for key K:
1. Count existing reports: `SELECT COUNT(*) WHERE key=K AND value=V`
2. If count ≥ 1: UPDATE in_stock to V, DELETE all reports for K, clear tracking
3. Else: INSERT new report

**Take/Return**: Affects BOTH in_stock AND real_number_reports.reported_number by same delta
- Example: in_stock=20, reported_number=23, take 3 → in_stock=17, reported_number=20

**Auto-Zero**: If 2+ "Not in stock" reports exist for component, set in_stock=0

**Approving a suggestion upserts.** A suggestion may be a brand-new part or an edit of a
live one, and both arrive in `suggested_components` identically. So `/approve` runs
`INSERT .. ON CONFLICT(inventory_key) DO UPDATE`: a new key inserts, an existing key has
its six mutable fields overwritten. Re-suggesting an edit for the same key likewise
replaces the pending suggestion rather than erroring.

## Files
- server.js: Express backend (all endpoints, logging, DB logic)
- src/App.jsx: React frontend (all UI features)
- src/views.js: React-free row filtering + location split/join, so tests need no bundler
- components.db: SQLite database, committed and shared — pull before editing, push after
- .env: local config — ADMIN_PASSWORD, PORT, DB_PATH (not committed; see .env.example)
- logs/database.log: Audit trail
