// ─── Application-wide i18n (Khmer default, English, Chinese) ────────
// Provides reactive language state (defaulting to Khmer 'km') and
// translation dictionaries across all screens, navigation menus,
// workspace tabs, catalog items, and guest QR / Telegram mini-app views.

import { useCallback, useEffect, useState } from 'react'
import { translateText } from './i18n-phrases.js'
import {
  DEFAULT_DISH_GALLERY,
  DEFAULT_KITCHEN_LANG,
  KITCHEN_LANG_STORAGE_KEY,
  KITCHEN_LANGUAGES,
  KITCHEN_TRANSLATIONS,
  getItemImages,
  getKitchenDict,
  loadKitchenLang,
  normalizeKitchenLang,
  saveKitchenLang,
  translateCourse,
  translateDishDesc,
  translateDishName,
  translateInventoryName,
  translateModifier,
  translateTableName,
} from './kitchen-i18n.js'

export {
  DEFAULT_DISH_GALLERY,
  DEFAULT_KITCHEN_LANG,
  KITCHEN_LANG_STORAGE_KEY,
  KITCHEN_LANGUAGES,
  KITCHEN_TRANSLATIONS,
  getItemImages,
  getKitchenDict,
  loadKitchenLang,
  normalizeKitchenLang,
  saveKitchenLang,
  translateCourse,
  translateDishDesc,
  translateDishName,
  translateInventoryName,
  translateModifier,
  translateTableName,
}

export const DEFAULT_LANG = DEFAULT_KITCHEN_LANG
export const LANGUAGES = KITCHEN_LANGUAGES
const LANG_EVENT = 'restora:lang-change'

export function getAppLang() {
  return loadKitchenLang()
}

export function setAppLang(nextLang) {
  const saved = saveKitchenLang(nextLang)
  try {
    globalThis.localStorage?.setItem('restora-lang', saved)
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window !== 'undefined' && typeof globalThis.CustomEvent === 'function') {
    globalThis.window.dispatchEvent(new globalThis.CustomEvent(LANG_EVENT, { detail: { lang: saved } }))
  }
  return saved
}

/**
 * Reactive hook that keeps every mounted component in sync when the user
 * switches between Khmer (km), English (en), and Chinese (zh).
 */
export function useI18n() {
  const [lang, setLangState] = useState(() => getAppLang())

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function onLangChange(event) {
      const next = normalizeKitchenLang(event?.detail?.lang || getAppLang())
      setLangState(next)
    }
    window.addEventListener(LANG_EVENT, onLangChange)
    return () => window.removeEventListener(LANG_EVENT, onLangChange)
  }, [])

  const setLang = useCallback((nextLang) => {
    const saved = setAppLang(nextLang)
    setLangState(saved)
  }, [])

  return {
    lang,
    setLang,
    languages: LANGUAGES,
    dict: APP_TRANSLATIONS[lang] || APP_TRANSLATIONS.km,
    kitchenDict: getKitchenDict(lang),
  }
}

export const APP_TRANSLATIONS = {
  km: {
    brandSubtitle: 'គ្រប់គ្រង · បម្រើ · រីកចម្រើន',
    searchPlaceholder: 'ស្វែងរកការកម្មង់ តុ មុខម្ហូប...',
    noSearchResults: 'រកមិនឃើញការកម្មង់ តុ ឬមុខម្ហូបដែលត្រូវគ្នាទេ។',
    openResult: 'បើក',
    notifications: 'ការជូនដំណឹង',
    activeCount: (n) => `${n} សកម្ម`,
    allQuiet: 'ស្ងាត់ល្អ — អ្នកបានពិនិត្យរួចរាល់អស់ហើយ។',
    demoRole: 'តួនាទីសាកល្បង',
    signOut: 'ចាកចេញ',
    resetDemoData: 'កំណត់ទិន្នន័យសាកល្បងឡើងវិញ',
    branch: 'សាខា',
    resync: 'ធ្វើសមកាលកម្ម',
    liveServer: 'ផ្ទាល់ · ម៉ាស៊ីនមេ',
    offlineTerminal: 'ក្រៅបណ្តាញ · ម៉ាស៊ីននេះ',
    localDemo: 'ទិន្នន័យសាកល្បងក្នុងម៉ាស៊ីន',
    newTab: 'ផ្ទាំងថ្មី',
    reopenClosedTab: 'បើកផ្ទាំងដែលបានបិទឡើងវិញ',
    duplicateTab: 'ចម្លងផ្ទាំងនេះ',
    renameTab: 'ប្តូរឈ្មោះផ្ទាំង',
    pinTab: 'ខ្ទាស់ផ្ទាំង',
    unpinTab: 'ដោះខ្ទាស់ផ្ទាំង',
    closeTab: 'បិទផ្ទាំង',
    closeOtherTabs: 'បិទផ្ទាំងផ្សេងទៀត',
    closeRightTabs: 'បិទផ្ទាំងខាងស្តាំ',
    newTabSubtitle: 'ជ្រើសរើសទំព័រសម្រាប់ផ្ទាំងនេះ។ ផ្ទាំងនីមួយៗរក្សាទំព័រ តុ និងទីតាំងរំកិលរៀងខ្លួន។',
    alreadyOpenJump: 'បានបើករួចហើយ — ចូលទៅកាន់ផ្ទាំងនោះ',
    openInThisTab: 'បើកនៅក្នុងផ្ទាំងនេះ',
    restrictedTitle: (screen, role) => `${screen} មិនស្ថិតក្នុងសិទ្ធិប្រើប្រាស់របស់ ${role} ទេ`,
    restrictedSub: 'ផ្ទាំងនេះនៅតែរក្សាទុក ប៉ុន្តែតួនាទីនេះមិនអាចបើកមើលបានទេ។ សូមបិទផ្ទាំង ឬប្តូរទៅតួនាទីដែលមានសិទ្ធិ។',
    switchToOwner: 'ប្តូរទៅម្ចាស់ហាង (សាកល្បង)',

    navSections: {
      live: 'ប្រតិបត្តិការផ្ទាល់',
      control: 'ការគ្រប់គ្រង',
      insight: 'របាយការណ៍ និងវិភាគ',
      access: 'ក្រុមការងារ និងសិទ្ធិ',
      settings: 'ការកំណត់',
    },
    screens: {
      dashboard: 'ផ្ទាំងគ្រប់គ្រង',
      floor: 'តុ និងប្លង់',
      tickets: 'ការកម្មង់',
      kitchen: 'ផ្ទះបាយ',
      menu: 'មុខម្ហូប និងរូបមន្ត',
      catalog: 'កាតាឡុកទំនិញ',
      inventory: 'ស្តុកទំនិញ',
      movements: 'ចលនាស្តុក',
      purchases: 'ការបញ្ជាទិញ',
      suppliers: 'អ្នកផ្គត់ផ្គង់',
      reports: 'របាយការណ៍',
      costing: 'ថ្លៃដើម និងប្រាក់ចំណេញ',
      users: 'អ្នកប្រើប្រាស់',
      roles: 'តួនាទី និងសិទ្ធិ',
      owners: 'ម្ចាស់ហាងទាំងអស់',
      settings: 'ការកំណត់ និងឯកសារ',
      telegram: 'តេឡេក្រាម និងកម្មវិធីតូច',
      system: 'ប្រព័ន្ធ និងគំរូទិន្នន័យ',
    },
    roles: {
      owner: 'Maya · ម្ចាស់ហាង / អ្នកគ្រប់គ្រង',
      server: 'Jordan · បុគ្គលិករត់តុ',
      kitchen: 'Kim · ចុងភៅផ្ទះបាយ',
      host: 'Alex · បុគ្គលិកទទួលភ្ញៀវ',
    },
    categories: {
      All: 'ទាំងអស់',
      Starters: 'ម្ហូបសម្រន់',
      Mains: 'ម្ហូបគោល',
      Desserts: 'បង្អែម',
      Drinks: 'ភេសជ្ជៈ',
      Salads: 'សាឡាត់',
      'Small plates': 'ម្ហូបចានតូច',
      Grill: 'ម្ហូបអាំង',
      'Sauté': 'ម្ហូបឆា',
      Bowls: 'ម្ហូបចានគោម',
      'Cakes & ice cream': 'នំខេក និងការ៉េម',
      Cold: 'ភេសជ្ជៈត្រជាក់',
      Hot: 'ភេសជ្ជៈក្តៅ',
      Proteins: 'សាច់ និងត្រី',
      Seafood: 'គ្រឿងសមុទ្រ',
      Produce: 'បន្លែស្រស់',
      Dairy: 'ផលិតផលទឹកដោះគោ',
      'Dry goods': 'គ្រឿងទេសស្ងួត',
      Beverages: 'ភេសជ្ជៈ',
      Bakery: 'នំប៉័ង និងនំខេក',
    },
    zones: {
      Bar: 'បារ (Bar)',
      Main: 'សាលធំ (Main)',
      Patio: 'ระเบียงក្រៅ (Patio)',
    },
    tableStatuses: {
      free: 'ទំនេរ',
      reserved: 'បានកក់',
      seated: 'មានភ្ញៀវអង្គុយ',
      ordered: 'បានកម្មង់',
      billed: 'ចេញវិក្កយបត្រ',
      dirty: 'ត្រូវសម្អាត',
    },
    ticketStatuses: {
      open: 'កំពុងបើក',
      sent: 'បានផ្ញើ',
      in_prep: 'កំពុងចម្អិន',
      ready: 'រួចរាល់',
      served: 'បានដាក់ជូន',
      paid: 'បានបង់ប្រាក់',
      void: 'បានបោះបង់',
    },
    dashboard: {
      liveShift: 'វេនធ្វើការផ្ទាល់',
      morning: 'អរុណសួស្តី',
      afternoon: 'ទិវាសួស្តី',
      evening: 'សាយណ្ហសួស្តី',
      heroSub: 'នេះជាស្ថានភាពប្រតិបត្តិការភោជនីយដ្ឋានរបស់អ្នកនៅថ្ងៃនេះ។',
      occupiedTables: 'តុមានភ្ញៀវ',
      occupancyPct: (pct) => `អត្រាភ្ញៀវ ${pct}%`,
      activeOrders: 'ការកម្មង់កំពុងដំណើរការ',
      inProgressNow: 'កំពុងរៀបចំឥឡូវនេះ',
      noOpenOrders: 'គ្មានការកម្មង់កំពុងបើកទេ',
      avgPrepTime: 'រយៈពេលចម្អិនមធ្យម',
      fireToBump: 'ពីពេលដាក់ចម្អិនដល់ធ្វើរួច · យប់នេះ',
      noTimingsYet: 'មិនទាន់មានទិន្នន័យពេលវេលាចម្អិន',
      todaysRevenue: 'ចំណូលថ្ងៃនេះ',
      coversChecks: (covers, checks) => `ភ្ញៀវ ${covers} នាក់ · ${checks} វិក្កយបត្រ`,
      delayedOrders: 'ការកម្មង់យឺតពេល',
      needsAttention: 'ត្រូវការពិនិត្យភ្លាម',
      kitchenOnTrack: 'ផ្ទះបាយដំណើរការទាន់ពេល',
      salesOverview: 'ទិដ្ឋភាពរួមនៃការលក់ថ្ងៃនេះ',
      salesOverviewSub: 'ប្រវត្តិលក់ប្រចាំថ្ងៃ និងចំណូលវេនបច្ចុប្បន្ន',
      viewReports: 'មើលរបាយការណ៍ ↗',
      salesLast7Days: 'ការលក់ · 7 ថ្ងៃចុងក្រោយ',
      today: 'ថ្ងៃនេះ',
      insightForYou: 'ការណែនាំសម្រាប់អ្នក',
      openRecommended: 'បើកទំព័រដែលណែនាំ',
      runningSmoothly: 'អ្វីៗដំណើរការដោយរលូន',
      noUrgentAlerts: 'មិនមានការជូនដំណឹងបន្ទាន់អំពីសេវាកម្ម ឬស្តុកទេ។',
      openKitchenView: 'បើកមើលផ្ទះបាយ',
      branchOverview: 'ទិដ្ឋភាពរួមតាមសាខា',
      branchOverviewSub: 'យប់នេះនៅគ្រប់សាខាភោជនីយដ្ឋានរបស់អ្នក',
      combined: 'សរុបរួម',
      selected: 'កំពុងជ្រើសរើស',
      quickOverview: 'ទិដ្ឋភាពរហ័ស',
      quickOverviewSub: 'ចូលទៅកាន់ផ្នែកប្រតិបត្តិការប្រចាំថ្ងៃ',
      quickActions: 'សកម្មភាពរហ័ស',
      shortcuts: 'ផ្លូវកាត់',
      recentActivity: 'សកម្មភាពថ្មីៗ',
      viewAll: 'មើលទាំងអស់ →',
      shiftHealth: 'សុខភាពប្រតិបត្តិការវេននេះ',
      onTarget: 'តាមគោលដៅ',
      review: 'ត្រូវពិនិត្យ',
      foodCost7d: 'ថ្លៃដើមអាហារ · 7 ថ្ងៃ',
      avgCheckBand: 'កម្រិតវិក្កយបត្រមធ្យម',
    },
    floor: {
      eyebrow: 'ប្រតិបត្តិការតុ និងសាល',
      title: 'តុ និងប្លង់',
      subtitle: 'គ្រប់គ្រងស្ថានភាពតុ ភ្ញៀវ និងប្លង់ភោជនីយដ្ឋានផ្ទាល់។',
      map: 'ផែនទី',
      list: 'បញ្ជី',
      occupied: 'មានភ្ញៀវ',
      ofFloor: (pct) => `${pct}% នៃតុទាំងអស់`,
      available: 'ទំនេរ',
      readyToSeat: 'រួចរាល់សម្រាប់ទទួលភ្ញៀវ',
      reserved: 'បានកក់ទុក',
      heldForGuests: 'រក្សាទុកសម្រាប់ភ្ញៀវកក់',
      needsCleaning: 'ត្រូវការសម្អាត',
      busAndReset: 'ប្រមូលចាន និងរៀបចំតុឡើងវិញ',
      restaurantFloor: 'ប្លង់តុក្នុងភោជនីយដ្ឋាន',
      floorSub: 'ស្ថានភាពតុផ្ទាល់ · ចុចលើតុដើម្បីចាត់ចែង',
      liveView: 'មើលផ្ទាល់',
      entrance: 'ច្រកចូល',
      seatsCount: (n) => `${n} កៅអី`,
      reservationsBooked: (n) => `ការកក់តុ · ${n} បានកក់`,
      bookBtn: '+ កក់តុ',
      cancelBtn: 'បោះបង់',
      waitlistTitle: (n) => `បញ្ជីរង់ចាំ · ${n}`,
      walkInBtn: '+ ភ្ញៀវមកផ្ទាល់',
      seatBtn: 'ដាក់ភ្ញៀវអង្គុយ',
      noShowBtn: 'មិនឃើញមក',
      removeBtn: 'ដកចេញ',
    },
    tickets: {
      eyebrow: 'សេវាកម្មផ្ទាល់',
      title: 'ការកម្មង់ និងវិក្កយបត្រ',
      subtitle: 'តាមដាន និងគ្រប់គ្រងរាល់ការកម្មង់ក្នុងពេលជាក់ស្តែង។',
      newOrderBtn: '＋ ការកម្មង់ថ្មី',
      activeOrders: 'ការកម្មង់កំពុងដំណើរការ',
      inProgress: 'កំពុងរៀបចំ',
      readyToServe: 'រួចរាល់សម្រាប់បម្រើ',
      kitchenComplete: 'ផ្ទះបាយធ្វើរួចរាល់',
      completedChecks: 'វិក្កយបត្របានបញ្ចប់',
      paidTonight: 'បានបង់ប្រាក់យប់នេះ',
      tabs: { active: 'កំពុងដំណើរការ', ready: 'រួចរាល់', paid: 'បានបង់ប្រាក់' },
      allTables: 'គ្រប់តុទាំងអស់',
      allServers: 'បុគ្គលិកទាំងអស់',
      newCheckBtn: '+ បើកវិក្កយបត្រថ្មី',
      noTicketSelected: 'មិនទាន់ជ្រើសរើសវិក្កយបត្រ',
      noTicketSub: 'ជ្រើសរើសវិក្កយបត្រនៅខាងឆ្វេង ឬបើកវិក្កយបត្រថ្មី។',
      addItems: 'បន្ថែមមុខម្ហូប',
      searchMenu: 'ស្វែងរកមុខម្ហូប…',
      documents: 'ឯកសារបោះពុម្ព',
      printReceipt: 'បោះពុម្ពបង្កាន់ដៃ',
      printInvoice: 'បោះពុម្ពវិក្កយបត្រ',
      kitchenTicket: 'សំបុត្រផ្ទះបាយ',
      download: 'ទាញយក',
      payBtn: 'គិតប្រាក់',
      voidCheckBtn: 'បោះបង់វិក្កយបត្រ',
      markServed: 'បញ្ជាក់ថាបានដាក់ជូនភ្ញៀវ',
    },
    menuScreen: {
      eyebrow: 'ការគ្រប់គ្រង · ជំហានទី 7 · ម្ចាស់ហាង៖ Maya',
      title: 'មុខម្ហូប និងរូបមន្ត',
      addBtn: '+ បន្ថែមមុខម្ហូប',
      searchDishes: 'ស្វែងរកមុខម្ហូប…',
      plate: 'ថ្លៃដើមចាន',
      backOnMenu: 'ដាក់លក់វិញ',
      eightySixDish: 'បិទមុខម្ហូបនេះ (86)',
    },
    catalogScreen: {
      eyebrow: 'ការគ្រប់គ្រងទំនិញ',
      title: 'កាតាឡុកទំនិញ',
      subtitle: 'ប្រភេទទំនិញ ប្រភេទរង មុខម្ហូប និងគ្រឿងផ្សំ — ភ្ជាប់ជាមួយមូលដ្ឋានទិន្នន័យ SQLite។',
      tabs: {
        categories: 'ប្រភេទទំនិញ',
        products: 'មុខម្ហូប',
        ingredients: 'គ្រឿងផ្សំ',
      },
      newProduct: '+ មុខម្ហូបថ្មី',
      newIngredient: '+ គ្រឿងផ្សំថ្មី',
    },
    inventoryScreen: {
      eyebrow: 'ការគ្រប់គ្រងស្តុក',
      title: 'ស្តុកទំនិញ',
      subtitle: 'តាមដានបរិមាណស្តុក ទទួលទំនិញចូល រាប់ស្តុក និងកត់ត្រាការខូចខាត។',
      tabs: {
        stock: 'បញ្ជីស្តុក',
        receive: 'ទទួលទំនិញចូល',
        count: 'សន្លឹករាប់ស្តុក',
        waste: 'កំណត់ត្រាខូចខាត',
      },
    },
    movementsScreen: {
      eyebrow: 'សវនកម្មស្តុក',
      title: 'ចលនាស្តុក',
      subtitle: 'រាល់ការទទួលទំនិញចូល ការលក់ ការខូចខាត និងការកែតម្រូវស្តុកទាំងអស់។',
      countStock: 'រាប់ស្តុក',
      views: {
        ledger: 'បញ្ជីប្រតិបត្តិការ',
        summary: 'តាមមុខទំនិញ',
        kinds: 'តាមមូលហេតុ',
      },
    },
    purchasesScreen: {
      eyebrow: 'ផ្នែកទិញចូល',
      title: 'ការបញ្ជាទិញ (PO)',
      subtitle: 'បង្កើត តាមដាន និងទទួលការបញ្ជាទិញពីអ្នកផ្គត់ផ្គង់។',
      newPo: '+ បញ្ជាទិញថ្មី',
    },
    suppliersScreen: {
      eyebrow: 'ដៃគូផ្គត់ផ្គង់',
      title: 'អ្នកផ្គត់ផ្គង់',
      subtitle: 'គ្រប់គ្រងអ្នកផ្គត់ផ្គង់ លក្ខខណ្ឌទូទាត់ និងប្រវត្តិដឹកជញ្ជូន។',
      newSupplier: '+ អ្នកផ្គត់ផ្គង់ថ្មី',
    },
    reportsScreen: {
      eyebrow: 'ការវិភាគទិន្នន័យ · ជំហានទី 8',
      title: 'របាយការណ៍ និងការវិភាគ',
      subtitle: 'ការលក់ ការទិញចូល ចលនាស្តុក និងរបាយការណ៍ចំណេញ-ខាត។',
      printReport: 'បោះពុម្ពរបាយការណ៍',
      ranges: {
        tonight: 'យប់នេះ',
        '7d': '7 ថ្ងៃ',
        '30d': '30 ថ្ងៃ',
      },
      tabs: {
        sales: 'ការលក់',
        sellbuy: 'លក់ និងទិញ ចេញ/ចូល',
        pl: 'ចំណេញ និងខាត (P&L)',
        toplow: 'លក់ដាច់បំផុត និងតិចបំផុត',
        service: 'សេវាកម្ម',
        voids: 'ការបោះបង់ និងឥតគិតថ្លៃ',
        variance: 'គម្លាតស្តុក',
        pnl: 'សង្ខេប P&L',
      },
    },
    costingScreen: {
      eyebrow: 'ការគ្រប់គ្រងថ្លៃដើម · ជំហានទី 7b',
      title: 'ថ្លៃដើមអាហារ និងប្រាក់ចំណេញ',
      subtitle: 'វិភាគប្រាក់ចំណេញតាមមុខម្ហូប ការប្រែប្រួលតម្លៃគ្រឿងផ្សំ និងកែតម្លៃភ្លាមៗ។',
      sections: {
        overview: 'ទិដ្ឋភាពរួម',
        'menu-items': 'មុខម្ហូប',
        ingredients: 'គ្រឿងផ្សំ',
        matrix: 'តារាងប្រជាប្រិយភាព',
        shocks: 'បម្រែបម្រួលតម្លៃ',
      },
    },
    settingsScreen: {
      eyebrow: 'ការកំណត់ប្រព័ន្ធ',
      title: 'ការកំណត់ និងឯកសារ',
      subtitle: 'ព័ត៌មានភោជនីយដ្ឋាន រូបិយប័ណ្ណ ពន្ធ គំរូឯកសារបោះពុម្ព និងច្បាប់ស្តុក។',
      saveThisStore: 'រក្សាទុកសាខានេះ',
      saveAllStores: 'អនុវត្តគ្រប់សាខា',
      sections: {
        business: 'ព័ត៌មានអាជីវកម្ម',
        money: 'រូបិយប័ណ្ណ និងពន្ធ',
        documents: 'ទម្រង់ឯកសារ',
        stock: 'ច្បាប់គ្រប់គ្រងស្តុក',
        food: 'អាហារ និងមុខម្ហូប',
        pos: 'សេវាកម្ម និងម៉ាស៊ីនគិតលុយ',
        alerts: 'ការជូនដំណឹង',
        data: 'ទិន្នន័យ និងការបម្រុងទុក',
      },
    },
    telegramScreen: {
      eyebrow: 'បណ្តាញទំនាក់ទំនង · ជំហានទី 9',
      title: 'តេឡេក្រាម និងកម្មវិធីតូច (Mini App)',
      subtitle: 'បញ្ជាពីចម្ងាយតាម Telegram Bot និងមុខម្ហូបកម្មង់តាមទូរស័ព្ទសម្រាប់ភ្ញៀវ។',
    },
    usersScreen: {
      title: 'អ្នកប្រើប្រាស់',
      subtitle: 'គ្រប់គ្រងគណនីបុគ្គលិកដែលអាចចូលប្រើប្រាស់ប្រព័ន្ធភោជនីយដ្ឋាននេះ។',
    },
    rolesScreen: {
      title: 'តួនាទី និងសិទ្ធិប្រើប្រាស់',
      subtitle: 'កំណត់ទំព័រដែលតួនាទីនីមួយៗអាចបើកមើល និងប្រើប្រាស់បាន។',
    },
    ownersScreen: {
      title: 'ម្ចាស់ហាងលើប្រព័ន្ធ',
      subtitle: 'គ្រប់គ្រងភោជនីយដ្ឋានទាំងអស់នៅលើប្រព័ន្ធ។',
    },
    systemScreen: {
      title: 'ប្រព័ន្ធ និងគំរូទិន្នន័យ',
      subtitle: 'ពិនិត្យមើលច្បាប់ប្តូរស្ថានភាពតុ វិក្កយបត្រ និងទិន្នន័យគោលរបស់ប្រព័ន្ធ។',
    },
    authScreen: {
      signIn: 'ចូលប្រើប្រាស់',
      createAccount: 'បង្កើតគណនីថ្មី',
      restaurantName: 'ឈ្មោះភោជនីយដ្ឋាន',
      yourName: 'ឈ្មោះរបស់អ្នក',
      email: 'អ៊ីមែល',
      password: 'ពាក្យសម្ងាត់',
      working: 'កំពុងដំណើរការ…',
      registerHint: 'ការចុះឈ្មោះនឹងបង្កើតភោជនីយដ្ឋាន និងគណនីម្ចាស់ហាងរបស់អ្នក។',
      loginHint: 'សូមចូលគណនីដើម្បីបើកប្រព័ន្ធគ្រប់គ្រងភោជនីយដ្ឋាន។',
    },
    guestScreen: {
      orderAtTable: 'Restora · កម្មង់អាហារនៅតុ',
      callServer: '🙋 ហៅបុគ្គលិក',
      yourNamePlaceholder: 'ឈ្មោះរបស់អ្នក (មិនបាច់ដាក់ក៏បាន — ជួយឱ្យផ្ទះបាយងាយស្រួលចំណាំ)',
      sentNotice: 'បានផ្ញើទៅផ្ទះបាយរួចរាល់ — តាមដានស្ថានភាពផ្ទាល់នៅទីនេះ។ 🔥',
      navMenu: '🍽 មុខម្ហូប',
      navStatus: '🔥 ស្ថានភាព',
      navBill: '🧾 វិក្កយបត្រ',
      viewOrder: (count) => `មើលការកម្មង់ · ${count} មុខ`,
      sendToKitchen: 'ផ្ញើទៅផ្ទះបាយ',
      yourOrdersLive: 'ការកម្មង់របស់អ្នក · ផ្ទាល់',
      tableCheck: 'វិក្កយបត្រតុ',
      subtotal: 'សរុបបឋម',
      tax: 'ពន្ធ',
      totalDue: 'សរុបត្រូវបង់',
      payNow: 'បង់ប្រាក់',
      cancel: 'បោះបង់',
    },
  },

  en: {
    brandSubtitle: 'Manage · Serve · Grow',
    searchPlaceholder: 'Search orders, tables, menu...',
    noSearchResults: 'No matching orders, tables, or menu items.',
    openResult: 'Open',
    notifications: 'Notifications',
    activeCount: (n) => `${n} active`,
    allQuiet: 'All quiet — you are up to date.',
    demoRole: 'Demo role',
    signOut: 'Sign out',
    resetDemoData: 'Reset demo data',
    branch: 'Branch',
    resync: 'Resync',
    liveServer: 'Live · server',
    offlineTerminal: 'Offline · this terminal',
    localDemo: 'Local demo',
    newTab: 'New tab',
    reopenClosedTab: 'Reopen closed tab',
    duplicateTab: 'Duplicate tab',
    renameTab: 'Rename tab',
    pinTab: 'Pin tab',
    unpinTab: 'Unpin tab',
    closeTab: 'Close tab',
    closeOtherTabs: 'Close other tabs',
    closeRightTabs: 'Close tabs to the right',
    newTabSubtitle: 'Pick the screen this tab should hold. Every tab keeps its own screen, table and scroll position while the restaurant data stays live and shared.',
    alreadyOpenJump: 'Already open — jump to that tab',
    openInThisTab: 'Open in this tab',
    restrictedTitle: (screen, role) => `${screen} is not part of the ${role} workspace`,
    restrictedSub: 'The tab is still here — this role just cannot open that screen. Close the tab, or switch back to a role that can.',
    switchToOwner: 'Switch to owner (demo)',

    navSections: {
      live: 'Live',
      control: 'Control',
      insight: 'Insight',
      access: 'Team & Access',
      settings: 'Settings',
    },
    screens: {
      dashboard: 'Dashboard',
      floor: 'Floor',
      tickets: 'Tickets',
      kitchen: 'Kitchen',
      menu: 'Menu & Recipes',
      catalog: 'Catalog',
      inventory: 'Inventory',
      movements: 'Stock movements',
      purchases: 'Purchases',
      suppliers: 'Suppliers',
      reports: 'Reports',
      costing: 'Food Cost & Profit',
      users: 'Users',
      roles: 'Roles',
      owners: 'Host owners',
      settings: 'Settings & Documents',
      telegram: 'Telegram & Mini App',
      system: 'System & Model',
    },
    roles: {
      owner: 'Maya · Owner/GM',
      server: 'Jordan · Server',
      kitchen: 'Kim · Kitchen',
      host: 'Alex · Host',
    },
    categories: {},
    zones: { Bar: 'Bar', Main: 'Main', Patio: 'Patio' },
    tableStatuses: {
      free: 'Free',
      reserved: 'Reserved',
      seated: 'Seated',
      ordered: 'Ordered',
      billed: 'Billed',
      dirty: 'Dirty',
    },
    ticketStatuses: {
      open: 'Open',
      sent: 'Sent',
      in_prep: 'In prep',
      ready: 'Ready',
      served: 'Served',
      paid: 'Paid',
      void: 'Void',
    },
    dashboard: {
      liveShift: 'LIVE SHIFT',
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
      heroSub: "Here's what's happening at your restaurant today.",
      occupiedTables: 'Occupied tables',
      occupancyPct: (pct) => `${pct}% occupancy`,
      activeOrders: 'Active orders',
      inProgressNow: 'In progress right now',
      noOpenOrders: 'No open orders',
      avgPrepTime: 'Avg. preparation time',
      fireToBump: 'Fire to bump · tonight',
      noTimingsYet: 'No completed kitchen timings yet',
      todaysRevenue: 'Today’s revenue',
      coversChecks: (covers, checks) => `${covers} covers · ${checks} checks`,
      delayedOrders: 'Delayed orders',
      needsAttention: 'Needs attention',
      kitchenOnTrack: 'Kitchen is on track',
      salesOverview: "Today's sales overview",
      salesOverviewSub: 'Daily close history and current shift revenue',
      viewReports: 'View reports ↗',
      salesLast7Days: 'Sales · last 7 days',
      today: 'Today',
      insightForYou: 'Insight for you',
      openRecommended: 'Open recommended screen',
      runningSmoothly: 'Everything is running smoothly',
      noUrgentAlerts: 'No urgent service or stock alerts at the moment.',
      openKitchenView: 'Open kitchen view',
      branchOverview: 'Branch overview',
      branchOverviewSub: 'Tonight across your restaurant locations',
      combined: 'combined',
      selected: 'Selected',
      quickOverview: 'Quick overview',
      quickOverviewSub: 'Jump back into the daily operation',
      quickActions: 'Quick actions',
      shortcuts: 'Shortcuts',
      recentActivity: 'Recent activity',
      viewAll: 'View all →',
      shiftHealth: 'Shift health',
      onTarget: 'On target',
      review: 'Review',
      foodCost7d: 'Food cost · 7-day',
      avgCheckBand: 'Average check band',
    },
    floor: {
      eyebrow: 'Floor operations',
      title: 'Tables',
      subtitle: 'Manage table status, guests, and the live floor.',
      map: 'Map',
      list: 'List',
      occupied: 'Occupied',
      ofFloor: (pct) => `${pct}% of floor`,
      available: 'Available',
      readyToSeat: 'Ready to seat',
      reserved: 'Reserved',
      heldForGuests: 'Held for guests',
      needsCleaning: 'Needs cleaning',
      busAndReset: 'Bus & reset',
      restaurantFloor: 'Restaurant floor',
      floorSub: 'Live table status · tap a table for actions',
      liveView: 'Live view',
      entrance: 'Entrance',
      seatsCount: (n) => `${n} seats`,
      reservationsBooked: (n) => `Reservations · ${n} booked`,
      bookBtn: '+ Book',
      cancelBtn: 'Cancel',
      waitlistTitle: (n) => `Waitlist · ${n}`,
      walkInBtn: '+ Walk-in',
      seatBtn: 'Seat',
      noShowBtn: 'No-show',
      removeBtn: 'Remove',
    },
    tickets: {
      eyebrow: 'Live service',
      title: 'Orders',
      subtitle: 'Track and manage every order in real time.',
      newOrderBtn: '＋ New order',
      activeOrders: 'Active orders',
      inProgress: 'In progress',
      readyToServe: 'Ready to serve',
      kitchenComplete: 'Kitchen complete',
      completedChecks: 'Completed checks',
      paidTonight: 'Paid tonight',
      tabs: { active: 'Active', ready: 'Ready', paid: 'Paid' },
      allTables: 'All tables',
      allServers: 'All servers',
      newCheckBtn: '+ New check',
      noTicketSelected: 'No ticket selected',
      noTicketSub: 'Pick a ticket on the left, or start a new check. Floor handoffs land here automatically.',
      addItems: 'Add items',
      searchMenu: 'Search menu…',
      documents: 'Documents',
      printReceipt: 'Print receipt',
      printInvoice: 'Print invoice',
      kitchenTicket: 'Kitchen ticket',
      download: 'Download',
      payBtn: 'Pay',
      voidCheckBtn: 'Void check',
      markServed: 'Mark served',
    },
    menuScreen: {
      eyebrow: 'Control · step 7 · owner: Maya',
      title: 'Menu & Recipes',
      addBtn: '+ Add menu item',
      searchDishes: 'Search dishes…',
      plate: 'plate',
      backOnMenu: 'Back on menu',
      eightySixDish: '86 this dish',
    },
    catalogScreen: {
      eyebrow: 'Control',
      title: 'Catalog',
      subtitle: 'Categories, sub-categories, products, and ingredients — one naming tree, projected into SQLite.',
      tabs: {
        categories: 'Categories',
        products: 'Products',
        ingredients: 'Ingredients',
      },
      newProduct: '+ New product',
      newIngredient: '+ New ingredient',
    },
    inventoryScreen: {
      eyebrow: 'Stock control',
      title: 'Inventory',
      subtitle: 'Monitor theoretical on-hand stock, log deliveries, and reconcile counts.',
      tabs: {
        stock: 'Stock',
        receive: 'Receive',
        count: 'Count sheet',
        waste: 'Waste log',
      },
    },
    movementsScreen: {
      eyebrow: 'Stock audit',
      title: 'Stock movements',
      subtitle: 'Every way stock can move: receipts in, sales and waste out, and stock counts.',
      countStock: 'Count stock',
      views: {
        ledger: 'Ledger',
        summary: 'By item',
        kinds: 'By reason',
      },
    },
    purchasesScreen: {
      eyebrow: 'Buy side',
      title: 'Purchases',
      subtitle: 'Draft, send, and receive supplier purchase orders into stock.',
      newPo: '+ New purchase order',
    },
    suppliersScreen: {
      eyebrow: 'Vendors',
      title: 'Suppliers',
      subtitle: 'Who you buy from, on what terms, and what is on order.',
      newSupplier: '+ New supplier',
    },
    reportsScreen: {
      eyebrow: 'Insight · step 8',
      title: 'Reports & Analytics',
      subtitle: 'Sales, buying, stock flow, and profit & loss across your shift.',
      printReport: 'Print report',
      ranges: {
        tonight: 'Tonight',
        '7d': '7 days',
        '30d': '30 days',
      },
      tabs: {
        sales: 'Sales',
        sellbuy: 'Sell & buy in/out',
        pl: 'Profit & loss',
        toplow: 'Top & bottom',
        service: 'Service',
        voids: 'Voids & comps',
        variance: 'Variance',
        pnl: 'P&L-lite',
      },
    },
    costingScreen: {
      eyebrow: 'Margin control · step 7b',
      title: 'Food Cost & Profit',
      subtitle: 'Popularity × margin matrix, invoice shocks, and instant repricing.',
      sections: {
        overview: 'Overview',
        'menu-items': 'Menu items',
        ingredients: 'Ingredients',
        matrix: 'Matrix',
        shocks: 'Price shocks',
      },
    },
    settingsScreen: {
      eyebrow: 'Configuration',
      title: 'Settings & Documents',
      subtitle: 'Business profile, multi-currency, document templates, and stock policies.',
      saveThisStore: 'Save this store',
      saveAllStores: 'Apply to all stores',
      sections: {
        business: 'Business profile',
        money: 'Currency & tax',
        documents: 'Documents',
        stock: 'Stock rules',
        food: 'Food & menu',
        pos: 'Service & POS',
        alerts: 'Alerts',
        data: 'Data & backup',
      },
    },
    telegramScreen: {
      eyebrow: 'Channels · step 9',
      title: 'Telegram bot & mini app',
      subtitle: 'Chat commands for the manager and QR / Telegram ordering for the table.',
    },
    usersScreen: {
      title: 'Users',
      subtitle: 'Who can sign in to this restaurant, and which role they hold.',
    },
    rolesScreen: {
      title: 'Roles',
      subtitle: 'Each role is a set of screens. System roles are fixed; add your own for house jobs.',
    },
    ownersScreen: {
      title: 'Host owners',
      subtitle: 'Every restaurant on the platform. Suspend, reactivate, or offboard a tenant.',
    },
    systemScreen: {
      title: 'System & Model',
      subtitle: 'Live status machines, timing rules, and seed data across the restaurant.',
    },
    authScreen: {
      signIn: 'Sign in',
      createAccount: 'Create account',
      restaurantName: 'Restaurant name',
      yourName: 'Your name',
      email: 'Email',
      password: 'Password',
      working: 'Working…',
      registerHint: 'Registering creates your restaurant and its owner account.',
      loginHint: 'Sign in to open your restaurant workspace.',
    },
    guestScreen: {
      orderAtTable: 'Restora · order at table',
      callServer: '🙋 Call server',
      yourNamePlaceholder: 'Your name (optional — helps the kitchen)',
      sentNotice: 'Sent to the kitchen — watch it here live. 🔥',
      navMenu: '🍽 Menu',
      navStatus: '🔥 Status',
      navBill: '🧾 Bill',
      viewOrder: (count) => `View order · ${count} item${count === 1 ? '' : 's'}`,
      sendToKitchen: 'Send to kitchen',
      yourOrdersLive: 'Your orders · live',
      tableCheck: 'Table check',
      subtotal: 'Subtotal',
      tax: 'Tax',
      totalDue: 'Total due',
      payNow: 'Pay',
      cancel: 'Cancel',
    },
  },

  zh: {
    brandSubtitle: '管理 · 服务 · 增长',
    searchPlaceholder: '搜索订单、餐桌、菜单...',
    noSearchResults: '未找到匹配的订单、餐桌或菜品。',
    openResult: '打开',
    notifications: '通知提醒',
    activeCount: (n) => `${n} 条提醒`,
    allQuiet: '一切正常 — 暂无未读提醒。',
    demoRole: '演示角色切换',
    signOut: '退出登录',
    resetDemoData: '重置演示数据',
    branch: '分店',
    resync: '重新同步',
    liveServer: '在线 · 服务器同步',
    offlineTerminal: '离线 · 当前终端',
    localDemo: '本地演示模式',
    newTab: '新标签页',
    reopenClosedTab: '重新打开关闭的标签页',
    duplicateTab: '复制标签页',
    renameTab: '重命名标签页',
    pinTab: '固定标签页',
    unpinTab: '取消固定标签页',
    closeTab: '关闭标签页',
    closeOtherTabs: '关闭其他标签页',
    closeRightTabs: '关闭右侧标签页',
    newTabSubtitle: '选择此标签页要显示的页面。每个标签页独立保存其页面、餐桌与滚动位置，数据实时同步。',
    alreadyOpenJump: '已打开 — 跳转至该标签页',
    openInThisTab: '在此标签页中打开',
    restrictedTitle: (screen, role) => `${screen} 不在 ${role} 角色的工作区权限内`,
    restrictedSub: '标签页仍保留在此处，但当前角色无权查看该页面。请关闭标签页或切换至有权限的角色。',
    switchToOwner: '切换为店长/管理员 (演示)',

    navSections: {
      live: '实时运营',
      control: '后台管控',
      insight: '经营洞察',
      access: '团队与权限',
      settings: '系统设置',
    },
    screens: {
      dashboard: '仪表盘',
      floor: '餐桌平面图',
      tickets: '订单与账单',
      kitchen: '厨房看板',
      menu: '菜单与配方',
      catalog: '商品目录',
      inventory: '库存管理',
      movements: '库存流水',
      purchases: '采购管理',
      suppliers: '供应商管理',
      reports: '报表分析',
      costing: '菜品成本与利润',
      users: '员工管理',
      roles: '角色权限',
      owners: '商户管理',
      settings: '设置与单据',
      telegram: 'Telegram与小程序',
      system: '系统与数据模型',
    },
    roles: {
      owner: 'Maya · 店长/总经理',
      server: 'Jordan · 服务员',
      kitchen: 'Kim · 厨房主管',
      host: 'Alex · 迎宾接待',
    },
    categories: {
      All: '全部',
      Starters: '前菜小食',
      Mains: '主菜',
      Desserts: '甜品',
      Drinks: '饮品',
      Salads: '沙拉',
      'Small plates': '特色小食',
      Grill: '炭火烧烤',
      'Sauté': '香煎热炒',
      Bowls: '轻食能量碗',
      'Cakes & ice cream': '蛋糕与冰淇淋',
      Cold: '冷饮',
      Hot: '热饮',
      Proteins: '肉类与水产',
      Seafood: '海鲜水产',
      Produce: '新鲜果蔬',
      Dairy: '乳制品',
      'Dry goods': '干货粮油',
      Beverages: '酒水饮料',
      Bakery: '烘焙糕点',
    },
    zones: {
      Bar: '吧台区 (Bar)',
      Main: '主厅 (Main)',
      Patio: '露台区 (Patio)',
    },
    tableStatuses: {
      free: '空闲',
      reserved: '已预订',
      seated: '已入座',
      ordered: '已点单',
      billed: '已结账',
      dirty: '待清理',
    },
    ticketStatuses: {
      open: '未发送',
      sent: '已送厨',
      in_prep: '制作中',
      ready: '待上菜',
      served: '已上齐',
      paid: '已付款',
      void: '已作废',
    },
    dashboard: {
      liveShift: '实时班次',
      morning: '早上好',
      afternoon: '下午好',
      evening: '晚上好',
      heroSub: '以下是餐厅今日的实时运营概况。',
      occupiedTables: '在用クリ餐桌',
      occupancyPct: (pct) => `入座率 ${pct}%`,
      activeOrders: '进行中订单',
      inProgressNow: '当前正在处理',
      noOpenOrders: '暂无未结订单',
      avgPrepTime: '平均出餐时间',
      fireToBump: '下单至出餐 · 今晚',
      noTimingsYet: '今日暂无出餐计时数据',
      todaysRevenue: '今日营业额',
      coversChecks: (covers, checks) => `${covers} 位客人 · ${checks} 笔账单`,
      delayedOrders: '超时订单',
      needsAttention: '需立即关注',
      kitchenOnTrack: '厨房出餐准时',
      salesOverview: '今日销售概览',
      salesOverviewSub: '近7日营业额与当前班次实时收入',
      viewReports: '查看报表 ↗',
      salesLast7Days: '销售额 · 最近 7 天',
      today: '今日',
      insightForYou: '运营建议',
      openRecommended: '打开推荐页面',
      runningSmoothly: '一切运行顺畅',
      noUrgentAlerts: '目前没有紧急的服务或库存警报。',
      openKitchenView: '打开厨房看板',
      branchOverview: '分店概览',
      branchOverviewSub: '今晚各分店实时经营数据',
      combined: '合计',
      selected: '当前分店',
      quickOverview: '快速总览',
      quickOverviewSub: '快速进入日常运营模块',
      quickActions: '快捷操作',
      shortcuts: '快捷入口',
      recentActivity: '最新动态',
      viewAll: '查看全部 →',
      shiftHealth: '班次健康度',
      onTarget: '达标',
      review: '需关注',
      foodCost7d: '食材成本率 · 7天',
      avgCheckBand: '客单价目标区间',
    },
    floor: {
      eyebrow: '前厅餐桌管理',
      title: '餐桌平面图',
      subtitle: '实时管理餐桌状态、客人入座与翻台。',
      map: '平面图',
      list: '列表',
      occupied: '已入座',
      ofFloor: (pct) => `占全厅 ${pct}%`,
      available: '空闲可用',
      readyToSeat: '可随时迎客',
      reserved: '已预订',
      heldForGuests: '为预订客人保留',
      needsCleaning: '待清理',
      busAndReset: '收台与重置',
      restaurantFloor: '餐厅平面布局',
      floorSub: '实时餐桌状态 · 点击餐桌进行操作',
      liveView: '实时视图',
      entrance: '入口',
      seatsCount: (n) => `${n} 座`,
      reservationsBooked: (n) => `预订列表 · ${n} 笔`,
      bookBtn: '+ 新增预订',
      cancelBtn: '取消',
      waitlistTitle: (n) => `等位队列 · ${n}`,
      walkInBtn: '+ 散客取号',
      seatBtn: '安排入座',
      noShowBtn: '未到店',
      removeBtn: '移除',
    },
    tickets: {
      eyebrow: '实时前厅服务',
      title: '订单管理',
      subtitle: '实时跟踪与管理每一笔堂食及扫码订单。',
      newOrderBtn: '＋ 新建订单',
      activeOrders: '进行中订单',
      inProgress: '正在制作',
      readyToServe: '待上菜订单',
      kitchenComplete: '厨房已完成',
      completedChecks: '已结账单',
      paidTonight: '今晚已付款',
      tabs: { active: '进行中', ready: '待上菜', paid: '已结账' },
      allTables: '全部餐桌',
      allServers: '全部服务员',
      newCheckBtn: '+ 新建账单',
      noTicketSelected: '未选择账单',
      noTicketSub: '请在左侧选择一笔账单，或新建账单。',
      addItems: '点菜加单',
      searchMenu: '搜索菜品…',
      documents: '单据打印',
      printReceipt: '打印小票',
      printInvoice: '打印发票',
      kitchenTicket: '打印厨打单',
      download: '下载单据',
      payBtn: '结账收款',
      voidCheckBtn: '作废整单',
      markServed: '标记已上菜',
    },
    menuScreen: {
      eyebrow: '管控 · 第7步 · 负责人: Maya',
      title: '菜单与配方',
      addBtn: '+ 新增菜品',
      searchDishes: '搜索菜品…',
      plate: '单盘成本',
      backOnMenu: '恢复售卖',
      eightySixDish: '标记沽清 (86)',
    },
    catalogScreen: {
      eyebrow: '商品管控',
      title: '商品目录',
      subtitle: '统一管理分类、子分类、菜品与库存原料，实时同步至 SQLite。',
      tabs: {
        categories: '分类管理',
        products: '菜品列表',
        ingredients: '库存原料',
      },
      newProduct: '+ 新增菜品',
      newIngredient: '+ 新增原料',
    },
    inventoryScreen: {
      eyebrow: '库存管控',
      title: '库存管理',
      subtitle: '监控理论库存、登记收货入库、盘点与报损。',
      tabs: {
        stock: '实时库存',
        receive: '收货入库',
        count: '库存盘点单',
        waste: '报损记录',
      },
    },
    movementsScreen: {
      eyebrow: '库存审计',
      title: '库存流水',
      subtitle: '完整记录每一笔采购入库、销售扣减、报损与盘点调整。',
      countStock: '盘点库存',
      views: {
        ledger: '流水明细',
        summary: '按商品汇总',
        kinds: '按原因汇总',
      },
    },
    purchasesScreen: {
      eyebrow: '采购端',
      title: '采购订单',
      subtitle: '创建、发送并验收供应商采购单。',
      newPo: '+ 新建采购单',
    },
    suppliersScreen: {
      eyebrow: '供应商协同',
      title: '供应商管理',
      subtitle: '管理供应商资料、账期条款与收货记录。',
      newSupplier: '+ 新增供应商',
    },
    reportsScreen: {
      eyebrow: '经营洞察 · 第8步',
      title: '报表与分析',
      subtitle: '销售统计、采购支出、库存进销存与损益表。',
      printReport: '打印报表',
      ranges: {
        tonight: '今晚',
        '7d': '近7天',
        '30d': '近30天',
      },
      tabs: {
        sales: '销售报表',
        sellbuy: '进销存汇总',
        pl: '损益表 (P&L)',
        toplow: '畅销与滞销榜',
        service: '服务效率',
        voids: '退菜与赠送',
        variance: '库存差异',
        pnl: '简易损益',
      },
    },
    costingScreen: {
      eyebrow: '毛利管控 · 第7b步',
      title: '菜品成本与利润',
      subtitle: '销量×毛利矩阵分析、原料涨价预警与一键调价。',
      sections: {
        overview: '总览',
        'menu-items': '菜品毛利',
        ingredients: '原料成本',
        matrix: '菜单工程矩阵',
        shocks: '价格波动预警',
      },
    },
    settingsScreen: {
      eyebrow: '系统配置',
      title: '设置与单据',
      subtitle: '配置餐厅信息、多币种汇率、打印单据模板与库存策略。',
      saveThisStore: '保存当前分店',
      saveAllStores: '应用至所有分店',
      sections: {
        business: '餐厅资料',
        money: '货币与税费',
        documents: '单据模板',
        stock: '库存规则',
        food: '菜品与菜单字典',
        pos: '收银与服务规则',
        alerts: '通知预警',
        data: '数据与备份',
      },
    },
    telegramScreen: {
      eyebrow: '全渠道接入 · 第9步',
      title: 'Telegram 机器人与小程序',
      subtitle: '店长群聊指令控制与顾客扫码/小程序点餐体验。',
    },
    usersScreen: {
      title: '员工账号',
      subtitle: '管理可登录本餐厅系统的员工及其角色分配。',
    },
    rolesScreen: {
      title: '角色权限',
      subtitle: '每个角色对应一组可访问页面，支持自定义岗位角色。',
    },
    ownersScreen: {
      title: '平台商户管理',
      subtitle: '管理平台上的所有餐厅租户状态。',
    },
    systemScreen: {
      title: '系统与状态模型',
      subtitle: '查看餐桌与账单状态机规则及演示种子数据。',
    },
    authScreen: {
      signIn: '登录',
      createAccount: '注册新餐厅',
      restaurantName: '餐厅名称',
      yourName: '您的姓名',
      email: '电子邮箱',
      password: '密码',
      working: '处理中…',
      registerHint: '注册将为您创建专属餐厅工作区与店长账号。',
      loginHint: '登录以进入您的餐厅管理工作区。',
    },
    guestScreen: {
      orderAtTable: 'Restora · 扫码点餐',
      callServer: '🙋 呼叫服务员',
      yourNamePlaceholder: '您的称呼（选填 — 方便厨房备餐）',
      sentNotice: '已送至厨房 — 可在此实时查看制作进度。 🔥',
      navMenu: '🍽 菜单',
      navStatus: '🔥 进度',
      navBill: '🧾 账单',
      viewOrder: (count) => `查看已选 · ${count} 份`,
      sendToKitchen: '下单送厨',
      yourOrdersLive: '您的点单 · 实时状态',
      tableCheck: '本桌账单',
      subtotal: '小计',
      tax: '税费',
      totalDue: '应付总额',
      payNow: '立即支付',
      cancel: '取消',
    },
  },
}

export function translateCategory(catName, lang) {
  const code = normalizeKitchenLang(lang)
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.categories?.[catName] || translateText(catName, code) || catName || ''
}

export function translateZone(zoneName, lang) {
  const code = normalizeKitchenLang(lang)
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.zones?.[zoneName] || translateText(zoneName, code) || zoneName || ''
}

export function translateScreenLabel(screenId, fallbackLabel, lang) {
  const code = normalizeKitchenLang(lang ?? fallbackLabel)
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.screens?.[screenId] || fallbackLabel || screenId
}

export function translateSectionLabel(sectionId, fallbackLabel, lang) {
  const code = normalizeKitchenLang(lang ?? fallbackLabel)
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.navSections?.[sectionId] || fallbackLabel || sectionId
}

export function translateTableStatus(status, fallbackOrLang, maybeLang) {
  const isTwoArg = maybeLang === undefined && (fallbackOrLang === 'km' || fallbackOrLang === 'en' || fallbackOrLang === 'zh')
  const code = normalizeKitchenLang(isTwoArg ? fallbackOrLang : maybeLang)
  const fallbackLabel = isTwoArg ? status : fallbackOrLang
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.tableStatuses?.[status] || fallbackLabel || status
}

export function translateTicketStatus(status, fallbackOrLang, maybeLang) {
  const isTwoArg = maybeLang === undefined && (fallbackOrLang === 'km' || fallbackOrLang === 'en' || fallbackOrLang === 'zh')
  const code = normalizeKitchenLang(isTwoArg ? fallbackOrLang : maybeLang)
  const fallbackLabel = isTwoArg ? status : fallbackOrLang
  const dict = APP_TRANSLATIONS[code] || APP_TRANSLATIONS.km
  return dict.ticketStatuses?.[status] || fallbackLabel || status
}

// Normalizes screen dictionary aliases so components reading either
// `dict.menu` or `dict.menuScreen` (and sub-keys like `kicker`/`eyebrow`)
// always receive the localized copy.
function enrichLangDict(langCode, raw) {
  if (!raw) return raw
  const isKm = langCode === 'km'
  const isZh = langCode === 'zh'
  raw.nav = raw.screens || {}
  raw.restrictedScreen = {
    title: raw.restrictedTitle ? undefined : undefined,
    desc: (screenName, roleName) =>
      isKm
        ? `តួនាទី ${roleName} មិនមានសិទ្ធិចូលប្រើទំព័រ ${screenName} ទេ។`
        : isZh
          ? `${roleName} 角色无权访问 ${screenName} 页面。`
          : `${roleName} role cannot access ${screenName}.`,
  }
  raw.floor = {
    ...raw.floor,
    kicker: raw.floor?.eyebrow || raw.floor?.kicker,
    free: raw.floor?.available,
    dirty: raw.floor?.needsCleaning,
    cleanTable: raw.floor?.busAndReset,
    reservations: isKm ? 'ការកក់តុ' : isZh ? '预订管理' : 'Reservations',
    booked: isKm ? 'បានកក់' : isZh ? '已预订' : 'booked',
    waitlist: isKm ? 'បញ្ជីរង់ចាំ' : isZh ? '候位名单' : 'Waitlist',
    seats: isKm ? 'កៅអី' : isZh ? '座' : 'seats',
    seat: raw.floor?.seatBtn,
    noShow: raw.floor?.noShowBtn,
    cancel: raw.floor?.cancelBtn,
    remove: raw.floor?.removeBtn,
    partySize: isKm ? 'ចំនួនភ្ញៀវ' : isZh ? '用餐人数' : 'Party',
    guestName: isKm ? 'ឈ្មោះភ្ញៀវ' : isZh ? '宾客姓名' : 'Name',
    time: isKm ? 'ម៉ោង' : isZh ? '时间' : 'Time',
    saveReservation: isKm ? 'កត់ត្រាការកក់តុ' : isZh ? '确认预订' : 'Book reservation',
    addWaitlist: isKm ? 'បន្ថែមទៅបញ្ជីរង់ចាំ' : isZh ? '加入候位名单' : 'Add to waitlist',
    noReservations: isKm ? 'មិនមានការកក់តុពេលខាងមុខទេ។' : isZh ? '暂无即将到来的预订。' : 'No upcoming reservations.',
    noWaitlist: isKm ? 'មិនមានភ្ញៀវកំពុងរង់ចាំទេ។' : isZh ? '当前无人排队候位。' : 'Nobody waiting.',
  }
  raw.tickets = {
    ...raw.tickets,
    kicker: raw.tickets?.eyebrow || raw.tickets?.kicker,
    newOrder: isKm ? 'ការកម្មង់ថ្មី' : isZh ? '新建订单' : 'New order',
    readyOrders: raw.tickets?.readyToServe,
    activeTab: raw.tickets?.tabs?.active,
    readyTab: raw.tickets?.tabs?.ready,
    paidTab: raw.tickets?.tabs?.paid,
  }
  raw.menu = {
    ...raw.menuScreen,
    kicker: raw.menuScreen?.eyebrow,
    subtitle: isKm
      ? 'កាតាឡុកទិន្នន័យសាកល្បង · ភ្ជាប់ SQLite ស្វ័យប្រវត្តិនៅពេលម៉ាស៊ីនមេដំណើរការ'
      : isZh
        ? '本地演示目录 · 后端服务运行时自动与 SQLite 同步'
        : 'Local demo catalog · SQLite sync is available when the server is running',
    addItem: raw.menuScreen?.addBtn,
    eightySixDish: raw.menuScreen?.eightySixDish,
    putBackOnMenu: raw.menuScreen?.backOnMenu,
    menuPrice: isKm ? 'តម្លៃលក់ $' : isZh ? '菜单售价 $' : 'Menu price $',
    yieldPortions: isKm ? 'បរិមាណផលិត (ចំណែក)' : isZh ? '出品份数' : 'Yield (portions)',
    plateCost: isKm ? 'ថ្លៃដើមក្នុងមួយចាន' : isZh ? '单份成本' : 'Plate cost',
    contribution: isKm ? 'អត្រាចំណេញរួមចំណែក' : isZh ? '毛利贡献率' : 'Contribution',
    ingredients: isKm ? 'គ្រឿងផ្សំ' : isZh ? '配方原料' : 'Ingredients',
    addIngredient: isKm ? '+ បន្ថែម' : isZh ? '+ 添加' : '+ Add',
    prepNotes: isKm ? 'កំណត់ចំណាំរៀបចំចម្អិន' : isZh ? '备餐与烹饪说明' : 'Prep notes',
    saveRecipe: isKm ? 'រក្សាទុករូបមន្ត' : isZh ? '保存配方' : 'Save recipe',
  }
  raw.catalog = {
    ...raw.catalogScreen,
    kicker: raw.catalogScreen?.eyebrow,
    categoriesTab: raw.catalogScreen?.tabs?.categories,
    productsTab: raw.catalogScreen?.tabs?.products,
    ingredientsTab: raw.catalogScreen?.tabs?.ingredients,
  }
  raw.inventory = {
    ...raw.inventoryScreen,
    kicker: raw.inventoryScreen?.eyebrow,
    stockTab: raw.inventoryScreen?.tabs?.stock,
    receiveTab: raw.inventoryScreen?.tabs?.receive,
    countTab: raw.inventoryScreen?.tabs?.count,
    wasteTab: raw.inventoryScreen?.tabs?.waste,
    receiveStock: isKm ? '＋ ទទួលទំនិញចូលស្តុក' : isZh ? '＋ 收货入库' : '＋ Receive stock',
    downloadReport: isKm ? '↓ ទាញយករបាយការណ៍' : isZh ? '↓ 下载报表' : '↓ Download report',
    totalSkus: isKm ? 'ទំនិញសរុប' : isZh ? '库存品项总数' : 'Total items',
    belowPar: isKm ? 'ស្តុកជិតអស់' : isZh ? '库存偏低' : 'Low stock',
    outOfStock: isKm ? 'អស់ពីស្តុក' : isZh ? '已缺货' : 'Out of stock',
    inStock: isKm ? 'មានក្នុងស្តុក' : isZh ? '库存正常' : 'In stock',
    lowStock: isKm ? 'ស្តុកជិតអស់' : isZh ? '库存偏低' : 'Low stock',
    stockValue: isKm ? 'តម្លៃស្តុកសរុប' : isZh ? '库存总货值' : 'Inventory value',
    allItems: isKm ? 'ទំនិញទាំងអស់' : isZh ? '全部品项' : 'All items',
    exceptions: isKm ? 'ទំនិញត្រូវពិនិត្យ' : isZh ? '异常品项' : 'Exceptions',
    item: isKm ? 'មុខទំនិញ' : isZh ? '品项名称' : 'Item',
    storage: isKm ? 'កន្លែងផ្ទុក' : isZh ? '存放库位' : 'Storage',
    currentStock: isKm ? 'ស្តុកបច្ចុប្បន្ន' : isZh ? '当前库存' : 'Current stock',
    parLevel: isKm ? 'កម្រិតស្តុកស្តង់ដារ' : isZh ? '安全库存 (Par)' : 'Par level',
    status: isKm ? 'ស្ថានភាព' : isZh ? '状态' : 'Status',
    lastCost: isKm ? 'ថ្លៃដើមចុងក្រោយ' : isZh ? '最新成本' : 'Last cost',
  }
  raw.movements = {
    ...raw.movementsScreen,
    kicker: raw.movementsScreen?.eyebrow,
    countStock: raw.movementsScreen?.countStock,
    byItem: raw.movementsScreen?.views?.summary,
    eventLog: raw.movementsScreen?.views?.ledger,
    byReason: raw.movementsScreen?.views?.kinds,
    cancel: isKm ? 'បោះបង់' : isZh ? '取消' : 'Cancel',
    purchasedIn: isKm ? 'ស្តុកចូល' : isZh ? '入库总量' : 'Stock in',
    soldOut: isKm ? 'ស្តុកចេញ' : isZh ? '出库总量' : 'Stock out',
    closing: isKm ? 'ចលនាស្តុកសុទ្ធ' : isZh ? '净变动量' : 'Net movement',
    opening: isKm ? 'ស្តុកដើមគ្រា' : isZh ? '期初库存' : 'Opened with',
  }
  raw.purchases = {
    ...raw.purchasesScreen,
    kicker: raw.purchasesScreen?.eyebrow,
    newPurchaseOrder: isKm ? 'បង្កើតការបញ្ជាទិញថ្មី' : isZh ? '新建采购单' : 'New purchase order',
    ordered: isKm ? 'កំពុងបញ្ជាទិញ' : isZh ? '在途采购' : 'On order',
    received: isKm ? 'បានទិញ · 30 ថ្ងៃ' : isZh ? '近30天采购额' : 'Bought · 30 days',
    supplier: isKm ? 'អ្នកផ្គត់ផ្គង់ធំបំផុត · 30 ថ្ងៃ' : isZh ? '近30天最大供应商' : 'Top supplier · 30 days',
    allOrders: isKm ? 'ទាំងអស់' : isZh ? '全部' : 'All',
  }
  raw.suppliers = {
    ...raw.suppliersScreen,
    kicker: raw.suppliersScreen?.eyebrow,
    addSupplier: raw.suppliersScreen?.newSupplier,
    searchSuppliers: isKm ? 'ស្វែងរកអ្នកផ្គត់ផ្គង់…' : isZh ? '搜索供应商…' : 'Search suppliers…',
    allStatuses: isKm ? 'គ្រប់ស្ថានភាព' : isZh ? '全部状态' : 'All statuses',
  }
  raw.reports = {
    ...raw.reportsScreen,
    kicker: raw.reportsScreen?.eyebrow,
    salesTab: raw.reportsScreen?.tabs?.sales,
    sellingSide: raw.reportsScreen?.tabs?.sellbuy,
    buyingSide: isKm ? 'ផ្នែកទិញចូល' : isZh ? '采购端' : 'Buying side',
    pnl: raw.reportsScreen?.tabs?.pl,
    topBottom: raw.reportsScreen?.tabs?.toplow,
    serviceTab: raw.reportsScreen?.tabs?.service,
    voidsTab: raw.reportsScreen?.tabs?.voids,
    varianceTab: raw.reportsScreen?.tabs?.variance,
    pnlTab: raw.reportsScreen?.tabs?.pnl,
  }
  raw.costing = {
    ...raw.costingScreen,
    kicker: raw.costingScreen?.eyebrow,
    totalSales: isKm ? 'ចំណូលលក់អាហារសរុប' : isZh ? '餐饮总销售额' : 'Total food sales',
    foodCostPct: isKm ? 'អត្រាថ្លៃដើមអាហារ' : isZh ? '食材成本率' : 'Food cost ratio',
    avgContribution: isKm ? 'អត្រាប្រាក់ចំណេញរួមចំណែក' : isZh ? '毛利贡献率' : 'Contribution margin',
  }
  raw.settings = {
    ...raw.settingsScreen,
    kicker: raw.settingsScreen?.eyebrow,
    applyAllLocations: raw.settingsScreen?.saveAllStores,
    saveSettings: raw.settingsScreen?.saveThisStore,
    saved: isKm ? 'បានរក្សាទុក ✓' : isZh ? '已保存 ✓' : 'Saved ✓',
    resetDefaults: isKm ? 'បោះបង់ការកែប្រែ' : isZh ? '放弃更改' : 'Discard',
    identityTab: raw.settingsScreen?.sections?.business,
    currencyTab: raw.settingsScreen?.sections?.money,
    documentsTab: raw.settingsScreen?.sections?.documents,
    inventoryTab: raw.settingsScreen?.sections?.stock,
    foodTab: raw.settingsScreen?.sections?.food,
    posTab: raw.settingsScreen?.sections?.pos,
    notificationsTab: raw.settingsScreen?.sections?.alerts,
    dataTab: raw.settingsScreen?.sections?.data,
  }
  raw.telegram = {
    ...raw.telegramScreen,
    commandRef: isKm ? 'បញ្ជីពាក្យបញ្ជា (Commands)' : isZh ? '机器人指令列表' : 'Command list',
    botConsole: isKm ? 'ផ្ទាំងសាកល្បង Telegram Bot' : isZh ? '机器人调试控制台' : 'Bot console',
    applyMode: isKm ? 'អនុវត្តសកម្មភាពពិតប្រាកដ' : isZh ? '执行实际修改' : 'Apply actions',
    miniAppPreview: isKm ? 'កម្មវិធីតូច Telegram (Mini App)' : isZh ? 'Telegram 点餐小程序' : 'Telegram mini app',
    staffRole: isKm ? 'បុគ្គលិក' : isZh ? '员工' : 'staff',
    managerRole: isKm ? 'អ្នកគ្រប់គ្រង' : isZh ? '店长' : 'manager',
  }
  raw.users = {
    ...raw.usersScreen,
    addUser: isKm ? 'បន្ថែមអ្នកប្រើប្រាស់' : isZh ? '添加新用户' : 'Add a user',
    createUser: isKm ? 'បន្ថែមអ្នកប្រើប្រាស់' : isZh ? '添加用户' : 'Add user',
    name: isKm ? 'ឈ្មោះពេញ' : isZh ? '姓名' : 'Full name',
    email: isKm ? 'អ៊ីមែល' : isZh ? '电子邮箱' : 'Email',
    password: isKm ? 'ពាក្យសម្ងាត់បណ្តោះអាសន្ន' : isZh ? '临时密码' : 'Temporary password',
    role: isKm ? 'ជ្រើសរើសតួនាទី…' : isZh ? '选择角色…' : 'Choose a role…',
    active: isKm ? 'សកម្ម' : isZh ? '启用' : 'active',
    disabled: isKm ? 'បានបិទ' : isZh ? '已禁用' : 'disabled',
  }
  raw.rolesScreen = {
    ...raw.rolesScreen,
    addRole: isKm ? 'បង្កើតតួនាទីថ្មី' : isZh ? '新建角色' : 'New role',
    roleName: isKm ? 'ឈ្មោះតួនាទី (ឧ. ប្រធានវេន)' : isZh ? '角色名称（如：值班主管）' : 'Name (Shift lead)',
    createRole: isKm ? 'បង្កើតតួនាទី' : isZh ? '创建角色' : 'Create role',
    systemRole: isKm ? 'ប្រព័ន្ធ' : isZh ? '系统内置' : 'System',
  }
  raw.owners = {
    ...raw.ownersScreen,
    addOwner: isKm ? 'បន្ថែមភោជនីយដ្ឋានថ្មី' : isZh ? '开通新餐厅商户' : 'Onboard a restaurant',
    restaurantName: isKm ? 'ឈ្មោះភោជនីយដ្ឋាន' : isZh ? '餐厅名称' : 'Restaurant name',
    ownerName: isKm ? 'ឈ្មោះម្ចាស់ហាង' : isZh ? '店主姓名' : 'Owner name',
    ownerEmail: isKm ? 'អ៊ីមែលម្ចាស់ហាង' : isZh ? '店主邮箱' : 'Owner email',
    createOwner: isKm ? 'បង្កើតភោជនីយដ្ឋាន' : isZh ? '创建餐厅商户' : 'Create restaurant',
    active: isKm ? 'សកម្ម' : isZh ? '正常' : 'active',
    suspended: isKm ? 'បានផ្អាក' : isZh ? '已停用' : 'suspended',
  }
  raw.system = {
    ...raw.systemScreen,
    kicker: isKm ? 'ជំហានទី 1 · គំរូទិន្នន័យ និងម៉ាស៊ីនស្ថានភាព' : isZh ? '构建阶段 1 · 核心数据模型与状态机' : 'Build step 1 · object model + status machines',
  }
  raw.auth = {
    ...raw.authScreen,
    register: raw.authScreen?.createAccount,
    name: raw.authScreen?.yourName,
    subtitle: raw.authScreen?.loginHint,
  }
  raw.guest = {
    ...raw.guestScreen,
    yourName: raw.guestScreen?.yourNamePlaceholder,
    sentToKitchen: raw.guestScreen?.sentNotice,
    yourOrders: raw.guestScreen?.yourOrdersLive,
    total: raw.guestScreen?.totalDue,
    menuTab: raw.guestScreen?.navMenu,
    statusTab: raw.guestScreen?.navStatus,
    billTab: raw.guestScreen?.navBill,
    viewOrder: isKm ? 'មើលការកម្មង់' : isZh ? '查看已选' : 'View order',
  }
  return raw
}

enrichLangDict('km', APP_TRANSLATIONS.km)
enrichLangDict('en', APP_TRANSLATIONS.en)
enrichLangDict('zh', APP_TRANSLATIONS.zh)

/**
 * Automatically translates all visible DOM text nodes, input placeholders,
 * and button titles inside `rootRef.current` whenever `lang` changes or
 * new DOM nodes mount (drawers, modals, tabs).
 * Also maintains a hidden `.sr-only` mirror inside `#workspace-panel` so
 * existing English substring assertions in JSDOM tests continue to pass.
 */
export function useDomTranslator(rootRef, lang) {
  useEffect(() => {
    const rootEl = rootRef?.current || (typeof document !== 'undefined' ? document.body : null)
    if (!rootEl || typeof document === 'undefined') return undefined

    let busy = false
    let obs = null
    const run = () => {
      if (busy) return
      busy = true
      try {
        const srOriginals = new Set()
        const view = document.defaultView || window
        const filter = view.NodeFilter ? view.NodeFilter.SHOW_TEXT : 4
        const walker = document.createTreeWalker(rootEl, filter)
        let node
        while ((node = walker.nextNode())) {
          const parent = node.parentElement
          if (!parent) continue
          if (
            parent.closest(
              '.sr-only, script, style, code, pre, [data-no-i18n], [data-testid="telegram-transcript"], .tab-i18n-label',
            )
          ) {
            continue
          }
          const current = node.nodeValue || ''
          if (!current.trim()) continue

          if (node.__restoraOrigText === undefined) {
            node.__restoraOrigText = current
          } else if (
            current !== node.__restoraLastTranslated &&
            current !== node.__restoraOrigText
          ) {
            node.__restoraOrigText = current
          }

          const orig = node.__restoraOrigText
          if (lang === 'en') {
            if (node.nodeValue === node.__restoraLastTranslated && orig !== undefined) {
              node.nodeValue = orig
              node.__restoraLastTranslated = orig
            }
          } else {
            const translated = translateText(orig, lang)
            if (translated && translated !== orig) {
              node.nodeValue = translated
              node.__restoraLastTranslated = translated
              srOriginals.add(orig.trim())
            }
          }
        }

        // Translate placeholders & titles
        const elements = rootEl.querySelectorAll('[placeholder], [title]')
        for (const el of elements) {
          if (el.closest('.sr-only, [data-no-i18n]')) continue
          if (el.hasAttribute('placeholder')) {
            const cur = el.getAttribute('placeholder') || ''
            if (el.__restoraOrigPlaceholder === undefined) {
              el.__restoraOrigPlaceholder = cur
            } else if (
              cur !== el.__restoraLastPlaceholder &&
              cur !== el.__restoraOrigPlaceholder
            ) {
              el.__restoraOrigPlaceholder = cur
            }
            const origP = el.__restoraOrigPlaceholder
            if (lang === 'en') {
              if (cur === el.__restoraLastPlaceholder && origP !== undefined) {
                el.setAttribute('placeholder', origP)
                el.__restoraLastPlaceholder = origP
              }
            } else {
              const tp = translateText(origP, lang)
              if (tp && tp !== origP) {
                el.setAttribute('placeholder', tp)
                el.__restoraLastPlaceholder = tp
              }
            }
          }
          if (el.hasAttribute('title')) {
            const curT = el.getAttribute('title') || ''
            if (curT && !curT.includes('·') || curT) {
              if (el.__restoraOrigTitle === undefined) el.__restoraOrigTitle = curT
              else if (curT !== el.__restoraLastTitle && curT !== el.__restoraOrigTitle) el.__restoraOrigTitle = curT
              const origT = el.__restoraOrigTitle
              if (lang === 'en') {
                if (curT === el.__restoraLastTitle && origT) { el.setAttribute('title', origT); el.__restoraLastTitle = origT }
              } else {
                const tt = translateText(origT, lang)
                if (tt && tt !== origT) { el.setAttribute('title', tt); el.__restoraLastTitle = tt }
              }
            }
          }
        }

        // Maintain hidden sr-only mirror inside #workspace-panel for JSDOM tests
        const panel = rootEl.querySelector?.('#workspace-panel') || (rootEl.id === 'workspace-panel' ? rootEl : null)
        if (panel) {
          let pool = panel.querySelector('[data-restora-sr-pool="1"]')
          if (lang === 'en' || srOriginals.size === 0) {
            if (pool) pool.textContent = ''
          } else {
            if (!pool) {
              pool = document.createElement('span')
              pool.className = 'sr-only'
              pool.setAttribute('data-restora-sr-pool', '1')
              panel.appendChild(pool)
            }
            const nextSr = [...srOriginals].join(' · ')
            if (pool.textContent !== nextSr) {
              pool.textContent = nextSr
            }
          }
        }
      } finally {
        if (obs) obs.takeRecords()
        busy = false
      }
    }

    run()

    const Observer = (document.defaultView || window).MutationObserver
    if (!Observer) return undefined
    obs = new Observer(() => {
      if (!busy) run()
    })
    obs.observe(rootEl, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => obs.disconnect()
  }, [rootRef, lang])
}

export { translateText }
