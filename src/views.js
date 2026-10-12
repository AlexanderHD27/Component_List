// Which component rows a given admin view shows. Kept out of App.jsx so it can be
// checked by test_views.js without React or a bundler.
export const visibleRows = (components, view, lowThreshold, filterZeroStock) =>
  view === 'suggested'
    ? []
    : components.filter((c) => {
        if (view === 'out') return c.in_stock === 0
        if (view === 'low') return c.in_stock > 0 && c.in_stock <= lowThreshold
        return filterZeroStock || c.in_stock > 0
      })

// A location lives in components.location as one "Main - Secondary" display string.
// The two entry dropdowns derive their values back out of it, so the table cells,
// the POST payload and visibleRows above all stay unaware of the split.
export const LOC_SEP = ' - '

export const splitLoc = (location) => {
  const [main = '', secondary = ''] = String(location || '').split(LOC_SEP)
  return { main, secondary }
}

export const joinLoc = (main, secondary) => (main && secondary ? main + LOC_SEP + secondary : main || '')

// Rows are grouped by category, then package, so same-kind parts sit together; the user
// only picks the direction of the name sort inside those groups.
// Natural, case-insensitive compare: this inventory is full of names like "22 Ohm 1%" and
// "100 Ohm 1%", which a plain string sort would order 100 before 22.
const cmp = (a, b) =>
  String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' })

export const sortRows = (rows, nameDir = 'asc') =>
  [...rows].sort(
    (a, b) =>
      cmp(a.category, b.category) ||
      cmp(a.package, b.package) ||
      (nameDir === 'desc' ? cmp(b.name, a.name) : cmp(a.name, b.name))
  )
