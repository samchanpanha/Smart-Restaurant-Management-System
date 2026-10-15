

const TABS = [
  { id: 'categories', label: 'Categories' },
  { id: 'products', label: 'Products' },
  { id: 'ingredients', label: 'Ingredients' },
]

const cardCls = 'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm'
const smallInput = 'w-full min-h-10 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100'

function cartesianFor(state, dish) {
  const recipe = state.recipes[dish.id]
  const suppliers = new Set()
  for (const ingredient of recipe?.ingredients || []) {
    const sku = state.inventory.find((item) => item.id === ingredient.inventoryItemId)
    const supplier = state.suppliers.find((entry) => entry.id === sku?.supplierId)
    if (supplier) suppliers.add(supplier.name)
  }
  return [...suppliers]
}


export { TABS, cardCls, smallInput, cartesianFor }
