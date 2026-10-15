import { useState } from 'react'

export const inputCls =
  'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'
export const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500'

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  )
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-zinc-500">{hint}</span>}
      </span>
    </label>
  )
}

export function Card({ title, sub, children, actions }) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** A chip list you can type into: the vocabulary items are tagged with. */
export function LabelListEditor({ label, hint, values, onChange, placeholder = 'Add…', max = 24 }) {
  const [entry, setEntry] = useState('')
  function add() {
    const value = entry.trim()
    if (!value) return
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setEntry('')
      return
    }
    onChange([...values, value].slice(0, max))
    setEntry('')
  }
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 && <span className="text-xs text-zinc-500">Nothing yet.</span>}
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((existing) => existing !== value))}
              className="text-zinc-400 hover:text-rose-600"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
          placeholder={placeholder}
          className={`${inputCls} max-w-[220px]`}
        />
        <button type="button" onClick={add} className="min-h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
          Add
        </button>
      </div>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </div>
  )
}
