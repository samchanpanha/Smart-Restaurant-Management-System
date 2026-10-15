import { useState } from 'react'
import StatusPill from '../../components/StatusPill'
import { useI18n } from '../../lib/i18n'
import { useRestora } from '../../lib/store'
import { TABS } from './shared.js'
import { CategoriesTab } from './sections/CategoriesTab.jsx'
import { ProductsTab } from './sections/ProductsTab.jsx'
import { IngredientsTab } from './sections/IngredientsTab.jsx'

function CatalogScreen({ initialTab = 'categories' }) {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const cat = dict.catalog || {}
  const [tab, setTab] = useState(initialTab)

  const counts = {
    categories: state.categories.length,
    products: state.menu.length,
    ingredients: state.inventory.length,
  }
  const subCategories = state.categories.filter((category) => category.parentId).length
  const tabLabels = {
    categories: cat.categoriesTab || 'Categories',
    products: cat.productsTab || 'Products',
    ingredients: cat.ingredientsTab || 'Ingredients',
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">{cat.kicker || 'Control'}</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{cat.title || 'Catalog'}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {cat.subtitle || 'Categories, sub-categories, products, and ingredients — one naming tree, projected into SQLite.'}
            {lang !== 'en' && (
              <span className="sr-only"> Categories, sub-categories, products, and ingredients</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <StatusPill tone="muted" size="sm">{state.categories.length} {cat.categoriesTab || 'categories'} · {subCategories} sub</StatusPill>
          <StatusPill tone="muted" size="sm">{state.menu.length} {cat.productsTab || 'products'}</StatusPill>
          <StatusPill tone="muted" size="sm">{state.inventory.length} {cat.ingredientsTab || 'ingredients'}</StatusPill>
        </div>
      </header>

      <div className="flex gap-1.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Catalog sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition ${tab === entry.id ? 'bg-orange-500 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'}`}
          >
            {tabLabels[entry.id] || entry.label}
            {lang !== 'en' && <span className="sr-only"> {entry.label}</span>}
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${tab === entry.id ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesTab banner={null} />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'ingredients' && <IngredientsTab />}
    </div>
  )
}

export default CatalogScreen
