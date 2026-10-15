import { Field, Toggle, Card, LabelListEditor, inputCls } from '../primitives'

function FoodSection({ draft, patch }) {
  const food = draft.food
  const setFood = (key, value) => patch({ food: { ...food, [key]: value } })

  function setWindow(id, patchWindow) {
    setFood('menuWindows', food.menuWindows.map((window) => (window.id === id ? { ...window, ...patchWindow } : window)))
  }
  function addWindow() {
    const n = food.menuWindows.length + 1
    setFood('menuWindows', [...food.menuWindows, { id: `window_${n}`, label: `Window ${n}`, from: '11:00', to: '16:00', enabled: false }].slice(0, 6))
  }

  return (
    <div className="space-y-4">
      <Card title="Menu vocabulary" sub="Items are tagged from these lists, so the guest menu, tickets, and reports speak one language.">
        <div className="grid gap-4 md:grid-cols-2">
          <LabelListEditor
            label="Dietary tags"
            hint="Shown on the guest menu and filterable in the composer."
            values={food.dietaryTags}
            onChange={(value) => setFood('dietaryTags', value)}
            placeholder="Gluten-free…"
          />
          <LabelListEditor
            label="Allergens"
            hint="Allergen alerts on the KDS read this list."
            values={food.allergens}
            onChange={(value) => setFood('allergens', value)}
            placeholder="Sesame…"
          />
          <LabelListEditor
            label="Courses"
            hint="Order of service on the ticket."
            values={food.courses}
            onChange={(value) => setFood('courses', value)}
            placeholder="Amuse…"
          />
          <LabelListEditor
            label="Spice levels"
            hint="Optional strength scale for a dish."
            values={food.spiceLevels}
            onChange={(value) => setFood('spiceLevels', value)}
            placeholder="Extra hot…"
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Default course for new items">
            <select value={food.defaultCourse} onChange={(event) => setFood('defaultCourse', event.target.value)} className={inputCls}>
              {food.courses.map((course) => <option key={course} value={course}>{course}</option>)}
            </select>
          </Field>
          <Field label="Food cost target" hint="Reports flag any period above this ratio (share of sales).">
            <input
              type="number" min="0" max="1" step="0.01"
              value={draft.foodCostCap}
              onChange={(event) => patch({ foodCostCap: Number(event.target.value) })}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
      </Card>

      <Card title="Item photos" sub="Uploaded photos are resized and compressed in the browser before they are stored with the item.">
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle
            label="Show photos on the menu screen"
            hint="Dish cards and the composer show the photo when an item has one."
            checked={food.showImages}
            onChange={(value) => setFood('showImages', value)}
          />
          <Toggle
            label="Show photos on the guest QR menu"
            hint="Off keeps the guest page lean on slow connections."
            checked={food.imagesOnGuestMenu}
            onChange={(value) => setFood('imagesOnGuestMenu', value)}
          />
          <Toggle
            label="Print photos on documents"
            hint="Thermal tickets should stay off; this is for invoice or menu-sheet style prints."
            checked={food.imagesInPrint}
            onChange={(value) => setFood('imagesInPrint', value)}
          />
          <Toggle
            label="Allergen alerts on the kitchen screen"
            hint="A ticket for a dish with allergens is flagged red on the KDS."
            checked={food.allergenAlerts}
            onChange={(value) => setFood('allergenAlerts', value)}
          />
          <Toggle
            label="Auto-86 when a linked ingredient runs out"
            hint="A dish with an empty key ingredient stops selling the moment stock hits zero."
            checked={food.auto86MissingIngredient}
            onChange={(value) => setFood('auto86MissingIngredient', value)}
          />
          <Toggle
            label="Children's menu"
            hint="Adds a kid-friendly section to the guest menu for items tagged Kid-friendly."
            checked={food.childrenMenu}
            onChange={(value) => setFood('childrenMenu', value)}
          />
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Photo size cap (kB)" hint="Larger caps mean sharper photos and heavier state snapshots.">
            <input
              type="number" min="20" max="600" step="10"
              value={food.imageMaxKb}
              onChange={(event) => setFood('imageMaxKb', Number(event.target.value))}
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
      </Card>

      <Card title="Service windows" sub="When each part of the menu is sellable. Assign a window to an item to hide it outside those hours.">
        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-3xs font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Sellable</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {food.menuWindows.map((window) => (
                <tr key={window.id}>
                  <td className="px-3 py-2">
                    <input
                      value={window.label}
                      aria-label={`${window.label} name`}
                      onChange={(event) => setWindow(window.id, { label: event.target.value })}
                      className={`${inputCls} min-h-9`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time" value={window.from} aria-label={`${window.label} from`}
                      onChange={(event) => setWindow(window.id, { from: event.target.value })}
                      className={`${inputCls} min-h-9 tnum`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time" value={window.to} aria-label={`${window.label} to`}
                      onChange={(event) => setWindow(window.id, { to: event.target.value })}
                      className={`${inputCls} min-h-9 tnum`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox" checked={window.enabled} aria-label={`${window.label} enabled`}
                      onChange={(event) => setWindow(window.id, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${window.label}`}
                      onClick={() => setFood('menuWindows', food.menuWindows.filter((entry) => entry.id !== window.id))}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {food.menuWindows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">No service windows — the whole menu sells all day.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addWindow}
          disabled={food.menuWindows.length >= 6}
          className="mt-3 min-h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Add window
        </button>
      </Card>
    </div>
  )
}

export { FoodSection }
