import { useState, useEffect } from 'react'
import './App.css'
import { visibleRows, sortRows, splitLoc, joinLoc } from './views'

const newKey = () => Math.random().toString(36).slice(2, 11)

const BLANK_FORM = {
  inventory_key: '',
  name: '',
  category: '',
  package: '',
  in_stock: 0,
  location: '',
  manufacturer_nr: ''
}

// Every call goes through here; a non-2xx response throws with the server's error text.
const api = async (path, { method = 'GET', body, pw } = {}) => {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pw && { 'x-admin-password': pw }) },
    body: body && JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

// Wraps a user action so a failure surfaces as an alert instead of vanishing.
const act = (fn) => (...args) => fn(...args).catch((err) => alert(err.message))

// The two dependent dropdowns over the locations relation list. value/onChange carry the
// single joined "Main - Secondary" string, so callers never deal with the two halves.
const LocationPicker = ({ value, onChange, locations }) => {
  const { main, secondary } = splitLoc(value)
  const mains = [...new Set(locations.map(l => l.main))]
  return (
    <>
      <select value={main} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select Main Location</option>
        {mains.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={secondary} disabled={!main} onChange={(e) => onChange(joinLoc(main, e.target.value))}>
        <option value="">Select Shelf</option>
        {locations.filter(l => l.main === main).map(l => <option key={l.id} value={l.secondary}>{l.secondary}</option>)}
      </select>
    </>
  )
}

// One-input dialog. actions are [label, className, onClick(value)]; Enter fires the first.
const Modal = ({ title, type = 'number', placeholder, actions, onClose }) => {
  const [value, setValue] = useState('')
  const fire = (fn) => { fn(value); setValue('') }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{title}</h2>
        <input
          type={type}
          autoFocus
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === 'Enter' && fire(actions[0][2])}
        />
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          {actions.map(([label, cls, fn]) => (
            <button key={label} className={'btn ' + cls} onClick={() => fire(fn)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [components, setComponents] = useState([])
  const [categories, setCategories] = useState([])
  const [packages, setPackages] = useState([])
  const [locations, setLocations] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newPackage, setNewPackage] = useState('')
  const [newLocMain, setNewLocMain] = useState('')
  const [newLocSec, setNewLocSec] = useState('')
  const [form, setForm] = useState(BLANK_FORM)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [adminPw, setAdminPw] = useState('')
  const [suggestedComponents, setSuggestedComponents] = useState([])
  const [showSuggested, setShowSuggested] = useState(false)
  const [showUseModal, setShowUseModal] = useState(null)
  const [showReportRealModal, setShowReportRealModal] = useState(null)
  const [filterZeroStock, setFilterZeroStock] = useState(true)
  const [view, setView] = useState('all')
  const [sortDir, setSortDir] = useState('asc')
  const [lowThreshold, setLowThreshold] = useState(5)
  const [reports, setReports] = useState([])
  const [ctxMenu, setCtxMenu] = useState(null)
  const [editKey, setEditKey] = useState(null)
  const [editForm, setEditForm] = useState(null)

  useEffect(() => {
    loadLists()
    fetchComponents()
    fetchSuggestedComponents()
  }, [search, categoryFilter])

  const loadLists = () =>
    Promise.all(['categories', 'packages', 'locations'].map((p) => api('/' + p)))
      .then(([c, p, l]) => { setCategories(c); setPackages(p); setLocations(l) })
      .catch(console.error)

  const fetchComponents = () =>
    api('/components?' + new URLSearchParams({ search, category: categoryFilter })).then(setComponents).catch(console.error)

  const fetchSuggestedComponents = () => api('/suggested_components').then(setSuggestedComponents).catch(console.error)

  const fetchReports = act(async (pw) => setReports(await api('/reports', { pw })))

  const toggleForm = () => {
    if (!showForm) setForm(f => (f.inventory_key ? f : { ...f, inventory_key: newKey() }))
    setShowForm(!showForm)
  }

  // categories and packages are both plain name lists behind the same POST shape.
  const addName = act(async (kind, value, reset) => {
    if (!value.trim()) return
    await api('/' + kind, { method: 'POST', body: { name: value } })
    reset('')
    loadLists()
  })

  const startEdit = (comp) => {
    setCtxMenu(null)
    setEditKey(comp.inventory_key)
    setEditForm({ ...comp })
  }

  // Copy reuses the add form wholesale. Everything carries over except the identity,
  // which has to be new or the save would collide with the part being copied.
  const startCopy = (comp) => {
    setCtxMenu(null)
    cancelEdit()
    setForm({ ...comp, inventory_key: newKey() })
    setShowForm(true)
  }

  const cancelEdit = () => { setEditKey(null); setEditForm(null) }

  // Admin writes the part directly; everyone else files the same edit as a suggestion,
  // which the existing approve flow then upserts onto the live row.
  const saveEdit = act(async () => {
    await api(`/components/${editKey}`, { method: 'PUT', body: editForm, pw: adminPw })
    cancelEdit()
    fetchComponents()
  })

  const suggestEdit = act(async () => {
    await api('/suggested_components', { method: 'POST', body: editForm })
    cancelEdit()
    fetchSuggestedComponents()
  })

  const handleAddLocation = act(async () => {
    if (!newLocMain.trim() || !newLocSec.trim()) return
    await api('/locations', { method: 'POST', body: { main: newLocMain, secondary: newLocSec } })
    setNewLocSec('')
    loadLists()
  })

  const handleAdd = (e) => {
    e.preventDefault()
    if (!adminPw) return setShowPasswordModal(true)
    saveComponent(adminPw)
  }

  const saveComponent = act(async (pw) => {
    await api('/components', { method: 'POST', body: form, pw })
    setForm(BLANK_FORM)
    setShowForm(false)
    fetchComponents()
  })

  const handleSuggest = act(async () => {
    await api('/suggested_components', { method: 'POST', body: form })
    setForm(BLANK_FORM)
    setShowForm(false)
    fetchSuggestedComponents()
  })

  const handleUnlock = async (password) => {
    try {
      await api('/admin/check', { pw: password })
    } catch {
      return alert('Incorrect password')
    }
    setAdminPw(password)
    setShowPasswordModal(false)
    if (showForm) saveComponent(password)
  }

  const handleDelete = act(async (key, name) => {
    if (!confirm(`Delete "${name}" (${key})? This cannot be undone.`)) return
    await api(`/components/${key}`, { method: 'DELETE', pw: adminPw })
    fetchComponents()
  })

  const handleApprove = act(async (key) => {
    await api(`/suggested_components/${key}/approve`, { method: 'POST', pw: adminPw })
    fetchComponents()
    fetchSuggestedComponents()
  })

  const handleReject = act(async (key, name) => {
    if (!confirm(`Reject suggestion "${name}"?`)) return
    await api(`/suggested_components/${key}`, { method: 'DELETE', pw: adminPw })
    fetchSuggestedComponents()
  })

  const handleReport = act(async (inventory_key, report_type) => {
    await api('/reports', { method: 'POST', body: { inventory_key, report_type } })
    fetchComponents()
  })

  const handleUse = act(async (inventory_key, action, amount) => {
    if (!amount || isNaN(amount)) return
    await api(`/components/${inventory_key}/use`, { method: 'POST', body: { amount: parseInt(amount), action } })
    setShowUseModal(null)
    fetchComponents()
  })

  const handleReportReal = act(async (inventory_key, amount) => {
    if (!amount || isNaN(amount)) return
    await api(`/components/${inventory_key}/report-real`, { method: 'POST', body: { reported_number: parseInt(amount) } })
    setShowReportRealModal(null)
    fetchComponents()
  })

  const rows = sortRows(visibleRows(components, view, lowThreshold, filterZeroStock), sortDir)

  const suggestedRows =
    view === 'suggested' || (view === 'all' && showSuggested) ? sortRows(suggestedComponents, sortDir) : []

  const changeView = (next) => {
    setView(next)
    if (next === 'reports') fetchReports(adminPw)
  }

  return (
    <div className="app">
      <h1>Lab Component Database</h1>

      <div className="toolbar">
        <div className="toolbar-group">
          <input
            className="search"
            type="text"
            placeholder="Search by name or inventory key..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          {view !== 'reports' && (
          <select value={sortDir} onChange={(e) => setSortDir(e.target.value)} title="Grouped by category, then package">
            <option value="asc">Name A–Z</option>
            <option value="desc">Name Z–A</option>
          </select>
          )}
          <button className={showForm ? 'btn' : 'btn btn-primary'} onClick={toggleForm}>
            {showForm ? 'Cancel' : 'Add Component'}
          </button>
        </div>
        <div className="toolbar-group">
          {view === 'all' && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showSuggested}
                  onChange={(e) => setShowSuggested(e.target.checked)}
                />
                Show Suggested Parts
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={filterZeroStock}
                  onChange={(e) => setFilterZeroStock(e.target.checked)}
                />
                Out of stock
              </label>
            </>
          )}
          {adminPw && (
            <>
              <select className="view-select" value={view} onChange={(e) => changeView(e.target.value)}>
                <option value="all">All components</option>
                <option value="out">Out of stock only</option>
                <option value="low">Low on parts</option>
                <option value="suggested">Suggested parts</option>
                <option value="reports">Reports</option>
              </select>
              {view === 'low' && (
                <label className="check">
                  ≤
                  <input
                    type="number"
                    min="0"
                    className="threshold"
                    value={lowThreshold}
                    onChange={(e) => setLowThreshold(Number(e.target.value))}
                  />
                  in stock
                </label>
              )}
            </>
          )}
          {adminPw ? (
            <button className="btn btn-admin" onClick={() => { setAdminPw(''); setView('all') }} title="Lock admin mode">
              Admin on — lock
            </button>
          ) : (
            <button className="btn" onClick={() => setShowPasswordModal(true)}>
              Admin
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="panel">
          <form onSubmit={handleAdd}>
            <div className="field">
              <label>Inventory Key *</label>
              <input required value={form.inventory_key} readOnly />
            </div>
            <div className="field">
              <label>Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Category *</label>
              <select required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Select Category</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <div className="field-add">
                <input type="text" placeholder="New category..." value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                <button type="button" className="btn btn-sm" onClick={() => addName('categories', newCategory, setNewCategory)}>Add</button>
              </div>
            </div>
            <div className="field">
              <label>Package</label>
              <select value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })}>
                <option value="">Select Package</option>
                {packages.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              <div className="field-add">
                <input type="text" placeholder="New package..." value={newPackage} onChange={(e) => setNewPackage(e.target.value)} />
                <button type="button" className="btn btn-sm" onClick={() => addName('packages', newPackage, setNewPackage)}>Add</button>
              </div>
            </div>
            <div className="field">
              <label>In Stock</label>
              <input type="number" value={form.in_stock} onChange={(e) => setForm({ ...form, in_stock: parseInt(e.target.value) })} />
            </div>
            <div className="field">
              <label>Location</label>
              <LocationPicker
                value={form.location}
                onChange={(v) => setForm({ ...form, location: v })}
                locations={locations}
              />
              <div className="field-add">
                <input type="text" placeholder="New main..." value={newLocMain} onChange={(e) => setNewLocMain(e.target.value)} />
                <input type="text" placeholder="New shelf..." value={newLocSec} onChange={(e) => setNewLocSec(e.target.value)} />
                <button type="button" className="btn btn-sm" onClick={handleAddLocation}>Add</button>
              </div>
            </div>
            <div className="field">
              <label>Manufacturer Number</label>
              <input value={form.manufacturer_nr} onChange={(e) => setForm({ ...form, manufacturer_nr: e.target.value })} />
            </div>
            <div className="actions">
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn btn-ok" onClick={handleSuggest}>Suggest</button>
            </div>
          </form>
        </div>
      )}

      {showPasswordModal && (
        <Modal
          title="Admin Password"
          type="password"
          placeholder="Enter password"
          actions={[['Unlock', 'btn-primary', handleUnlock]]}
          onClose={() => setShowPasswordModal(false)}
        />
      )}

      {showUseModal && (
        <Modal
          title="Use Component"
          placeholder="Amount"
          actions={[
            ['Take', 'btn-warn', (v) => handleUse(showUseModal, 'take', v)],
            ['Return', 'btn-ok', (v) => handleUse(showUseModal, 'return', v)]
          ]}
          onClose={() => setShowUseModal(null)}
        />
      )}

      {showReportRealModal && (
        <Modal
          title="Report Real Number"
          placeholder="Actual quantity"
          actions={[['Report', 'btn-primary', (v) => handleReportReal(showReportRealModal, v)]]}
          onClose={() => setShowReportRealModal(null)}
        />
      )}

      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button onClick={() => startEdit(ctxMenu.comp)}>Edit</button>
            <button onClick={() => startCopy(ctxMenu.comp)}>Copy</button>
          </div>
        </>
      )}

      {view === 'reports' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Inventory Key</th>
                <th>Name</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.timestamp}</td>
                  <td className="mono">{r.inventory_key}</td>
                  <td className="name">{r.name || '— deleted —'}</td>
                  <td>{r.report_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reports.length === 0 && <p className="empty">No reports filed.</p>}
        </div>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Inventory Key</th>
              <th>Name</th>
              <th>Category</th>
              <th>Package</th>
              <th style={{ textAlign: 'right' }}>In Stock</th>
              <th>Location</th>
              <th>Manufacturer Nr</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((comp) => (
              <tr
                key={comp.inventory_key}
                className={comp.in_stock === 0 ? 'is-empty' : undefined}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, comp }) }}
              >
                <td className="mono">{comp.inventory_key}</td>
                {editKey === comp.inventory_key ? (
                  <>
                    <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={editForm.package || ''} onChange={(e) => setEditForm({ ...editForm, package: e.target.value })}>
                        <option value="">—</option>
                        {packages.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <input type="number" min="0" value={editForm.in_stock} onChange={(e) => setEditForm({ ...editForm, in_stock: e.target.value })} />
                    </td>
                    <td>
                      <LocationPicker
                        value={editForm.location || ''}
                        onChange={(v) => setEditForm({ ...editForm, location: v })}
                        locations={locations}
                      />
                    </td>
                    <td><input value={editForm.manufacturer_nr || ''} onChange={(e) => setEditForm({ ...editForm, manufacturer_nr: e.target.value })} /></td>
                  </>
                ) : (
                  <>
                    <td className="name">{comp.name}</td>
                    <td>{comp.category}</td>
                    <td>{comp.package}</td>
                    <td className="num">{comp.in_stock}</td>
                    <td>{comp.location}</td>
                    <td className="mono">{comp.manufacturer_nr}</td>
                  </>
                )}
                <td>
                  <div className="cell-actions">
                    {editKey === comp.inventory_key ? (
                      <>
                        {adminPw
                          ? <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                          : <button className="btn btn-sm btn-ok" onClick={suggestEdit}>Suggest</button>}
                        <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                      </>
                    ) : (<>
                    <button className="btn btn-sm btn-primary" onClick={() => setShowUseModal(showUseModal === comp.inventory_key ? null : comp.inventory_key)}>Use</button>
                    <select
                      className="report-select"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === 'real') setShowReportRealModal(comp.inventory_key)
                        else if (v) handleReport(comp.inventory_key, v)
                      }}
                    >
                      <option value="">Report…</option>
                      <option value="Not in place">Not in place</option>
                      <option value="Not in stock">Not in stock</option>
                      <option value="Low on stock">Low on stock</option>
                      <option value="Wrong parts">Wrong parts</option>
                      <option value="real">Report real number</option>
                    </select>
                    {adminPw && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(comp.inventory_key, comp.name)}>Delete</button>
                    )}
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
            {suggestedRows.map((comp) => (
              <tr key={'suggested-' + comp.inventory_key} className={comp.in_stock === 0 ? 'is-empty' : 'is-suggested'}>
                <td className="mono">{comp.inventory_key}</td>
                <td className="name">{comp.name}</td>
                <td>{comp.category}</td>
                <td>{comp.package}</td>
                <td className="num">{comp.in_stock}</td>
                <td>{comp.location}</td>
                <td className="mono">{comp.manufacturer_nr}</td>
                <td>
                  {adminPw ? (
                    <div className="cell-actions">
                      <button className="btn btn-sm btn-ok" onClick={() => handleApprove(comp.inventory_key)}>Approve</button>
                      <button className="btn btn-sm" onClick={() => handleReject(comp.inventory_key, comp.name)}>Reject</button>
                    </div>
                  ) : (
                    <span className="tag">Suggested</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && suggestedRows.length === 0 && (
          <p className="empty">Nothing to show in this view.</p>
        )}
      </div>
      )}
    </div>
  )
}

export default App
