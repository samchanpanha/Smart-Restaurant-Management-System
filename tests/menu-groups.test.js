import assert from 'node:assert/strict'
import test from 'node:test'
import {
  categoryTotalCount,
  categoryTree,
  groupMenuByCategories,
  itemsInCategory,
} from '../src/lib/settings.js'
import { buildEmpire, shopReducer } from '../src/lib/reducer.js'

function freshDowntown() {
  return buildEmpire().locations.downtown
}

test('categoryTotalCount: sums direct items and subcategory items under parent', () => {
  const categories = [
    { id: 'cat_mains', name: 'Mains', kind: 'menu', parentId: null, sortOrder: 0 },
    { id: 'cat_burgers', name: 'Burgers', kind: 'menu', parentId: 'cat_mains', sortOrder: 0 },
    { id: 'cat_pasta', name: 'Pasta', kind: 'menu', parentId: 'cat_mains', sortOrder: 1 },
    { id: 'cat_drinks', name: 'Drinks', kind: 'menu', parentId: null, sortOrder: 1 },
  ]

  const menu = [
    { id: 'm1', name: 'Steak', category: 'Mains', subCategory: '' },
    { id: 'm2', name: 'Cheese Burger', category: 'Mains', subCategory: 'Burgers' },
    { id: 'm3', name: 'Veggie Burger', category: 'Mains', subCategory: 'Burgers' },
    { id: 'm4', name: 'Bolognese', category: 'Mains', subCategory: 'Pasta' },
    { id: 'm5', name: 'Cola', category: 'Drinks', subCategory: '' },
  ]

  const mainsTotal = categoryTotalCount(categories, 'cat_mains', menu, 'menu')
  assert.equal(mainsTotal, 4, 'Mains parent has 4 items total (1 direct + 2 burgers + 1 pasta)')

  const burgersTotal = categoryTotalCount(categories, 'cat_burgers', menu, 'menu')
  assert.equal(burgersTotal, 2, 'Burgers sub-category has 2 items')

  const pastaTotal = categoryTotalCount(categories, 'cat_pasta', menu, 'menu')
  assert.equal(pastaTotal, 1, 'Pasta sub-category has 1 item')

  const drinksTotal = categoryTotalCount(categories, 'cat_drinks', menu, 'menu')
  assert.equal(drinksTotal, 1, 'Drinks parent has 1 item')
})

test('groupMenuByCategories: cleanly structures roots, direct items, and sub-groups', () => {
  const categories = [
    { id: 'cat_mains', name: 'Mains', kind: 'menu', parentId: null, sortOrder: 0 },
    { id: 'cat_burgers', name: 'Burgers', kind: 'menu', parentId: 'cat_mains', sortOrder: 0 },
  ]

  const menu = [
    { id: 'm1', name: 'Steak', category: 'Mains', subCategory: '' },
    { id: 'm2', name: 'Classic Burger', category: 'Mains', subCategory: 'Burgers' },
    { id: 'm3', name: 'Mystery Dish', category: 'Specials', subCategory: '' },
  ]

  const { groups, uncategorized } = groupMenuByCategories(menu, categories)

  assert.equal(groups.length, 1, 'One root category group (Mains)')
  const mainsGroup = groups[0]
  assert.equal(mainsGroup.category.name, 'Mains')
  assert.equal(mainsGroup.directItems.length, 1, '1 direct item (Steak)')
  assert.equal(mainsGroup.directItems[0].name, 'Steak')
  assert.equal(mainsGroup.children.length, 1, '1 sub-category (Burgers)')
  assert.equal(mainsGroup.children[0].items.length, 1, '1 burger item')
  assert.equal(mainsGroup.children[0].items[0].name, 'Classic Burger')
  assert.equal(mainsGroup.totalCount, 2, '2 total items in Mains')

  assert.equal(uncategorized.length, 1, '1 uncategorized item (Specials)')
  assert.equal(uncategorized[0].name, 'Mystery Dish')
})

test('itemsInCategory: returns items matching parent or any descendant sub-categories', () => {
  const categories = [
    { id: 'cat_mains', name: 'Mains', kind: 'menu', parentId: null },
    { id: 'cat_burgers', name: 'Burgers', kind: 'menu', parentId: 'cat_mains' },
  ]

  const menu = [
    { id: 'm1', name: 'Steak', category: 'Mains', subCategory: '' },
    { id: 'm2', name: 'Bacon Burger', category: 'Mains', subCategory: 'Burgers' },
    { id: 'm3', name: 'Salad', category: 'Starters', subCategory: '' },
  ]

  const mainsMatches = itemsInCategory(menu, categories, 'cat_mains')
  assert.equal(mainsMatches.length, 2, 'Matches direct Steak and subcategory Burger')

  const burgerMatches = itemsInCategory(menu, categories, 'cat_burgers')
  assert.equal(burgerMatches.length, 1, 'Matches only Burger')
  assert.equal(burgerMatches[0].name, 'Bacon Burger')
})

test('REORDER_CATEGORIES action: updates sortOrder for categories', () => {
  const shop = freshDowntown()
  const initialCats = categoryTree(shop.categories, 'menu')
  assert.ok(initialCats.length >= 2, 'Shop starts with multiple menu categories')

  const originalOrder = initialCats.map((c) => c.id)
  const reversedOrder = [...originalOrder].reverse()

  const updatedShop = shopReducer(shop, {
    type: 'REORDER_CATEGORIES',
    categoryIds: reversedOrder,
  })

  const newTree = categoryTree(updatedShop.categories, 'menu')
  assert.equal(newTree[0].id, reversedOrder[0], 'First item in tree matches reversed order')
  assert.equal(newTree[newTree.length - 1].id, reversedOrder[reversedOrder.length - 1])
})

test('REORDER_MENU_ITEMS action: updates sortOrder for menu items', () => {
  const shop = freshDowntown()
  const firstItem = shop.menu[0]
  const secondItem = shop.menu[1]

  const updatedShop = shopReducer(shop, {
    type: 'REORDER_MENU_ITEMS',
    itemIds: [secondItem.id, firstItem.id],
  })

  const newFirst = updatedShop.menu.find((m) => m.id === secondItem.id)
  const newSecond = updatedShop.menu.find((m) => m.id === firstItem.id)

  assert.equal(newFirst.sortOrder, 0)
  assert.equal(newSecond.sortOrder, 1)
})

test('MOVE_CATEGORY_ITEMS action: bulk moves items to another category / sub-category', () => {
  const shop = freshDowntown()
  const mainsItems = shop.menu.filter((m) => m.category === 'Mains')
  assert.ok(mainsItems.length > 0, 'Found Mains items to move')

  const updatedShop = shopReducer(shop, {
    type: 'MOVE_CATEGORY_ITEMS',
    fromCategory: 'Mains',
    fromSubCategory: '',
    toCategory: 'Specials',
    toSubCategory: 'Chef Picks',
  })

  const movedItems = updatedShop.menu.filter((m) => mainsItems.some((orig) => orig.id === m.id))
  for (const item of movedItems) {
    assert.equal(item.category, 'Specials', 'item category updated to Specials')
    assert.equal(item.subCategory, 'Chef Picks', 'item subCategory updated to Chef Picks')
  }

  const remainingMains = updatedShop.menu.filter((m) => m.category === 'Mains')
  assert.equal(remainingMains.length, 0, 'No direct items left in Mains')
})
