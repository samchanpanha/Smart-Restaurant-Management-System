// ─── Kitchen multi-language (Khmer default, English, Chinese) & item media ──
// Provides translations for the Kitchen Display System (KDS) in Khmer (km),
// English (en), and Chinese (zh), with Khmer ('km') as the default language,
// plus helpers to resolve multiple reference photos per menu item.

export const DEFAULT_KITCHEN_LANG = 'km'
export const KITCHEN_LANG_STORAGE_KEY = 'restora-kitchen-lang'

export const KITCHEN_LANGUAGES = [
  { id: 'km', label: 'ខ្មែរ', nativeName: 'ភាសាខ្មែរ', englishName: 'Khmer', short: 'KH', flag: '🇰🇭' },
  { id: 'en', label: 'English', nativeName: 'English', englishName: 'English', short: 'EN', flag: '🇬🇧' },
  { id: 'zh', label: '中文', nativeName: '中文', englishName: 'Chinese', short: 'ZH', flag: '🇨🇳' },
]

export const DEFAULT_DISH_GALLERY = {
  m_salad: ['/photos/salad.svg', '/photos/salad-prep.svg', '/photos/salad-detail.svg'],
  m_wings: ['/photos/wings.svg', '/photos/wings-prep.svg', '/photos/wings-detail.svg'],
  m_soup: ['/photos/soup.svg', '/photos/soup-prep.svg', '/photos/soup-detail.svg'],
  m_burger: ['/photos/burger.svg', '/photos/burger-prep.svg', '/photos/burger-detail.svg'],
  m_salmon: ['/photos/salmon.svg', '/photos/salmon-prep.svg', '/photos/salmon-detail.svg'],
  m_chickenpasta: ['/photos/chickenpasta.svg', '/photos/chickenpasta-prep.svg', '/photos/chickenpasta-detail.svg'],
  m_steak: ['/photos/steak.svg', '/photos/steak-prep.svg', '/photos/steak-detail.svg'],
  m_fishchips: ['/photos/fishchips.svg', '/photos/fishchips-prep.svg', '/photos/fishchips-detail.svg'],
  m_vegbowl: ['/photos/vegbowl.svg', '/photos/vegbowl-prep.svg', '/photos/vegbowl-detail.svg'],
  m_cake: ['/photos/cake.svg', '/photos/cake-prep.svg', '/photos/cake-detail.svg'],
  m_icecream: ['/photos/icecream.svg', '/photos/icecream-prep.svg', '/photos/icecream-detail.svg'],
  m_soda: ['/photos/soda.svg', '/photos/soda-prep.svg', '/photos/soda-detail.svg'],
  m_coffee: ['/photos/coffee.svg', '/photos/coffee-prep.svg', '/photos/coffee-detail.svg'],
}

export function normalizeKitchenLang(lang) {
  const code = String(lang || '').trim().toLowerCase()
  if (code === 'km' || code === 'kh' || code === 'khmer') return 'km'
  if (code === 'en' || code === 'eng' || code === 'english') return 'en'
  if (code === 'zh' || code === 'cn' || code === 'chinese') return 'zh'
  return DEFAULT_KITCHEN_LANG
}

export function loadKitchenLang() {
  try {
    const saved = globalThis.localStorage?.getItem(KITCHEN_LANG_STORAGE_KEY)
    if (!saved) return DEFAULT_KITCHEN_LANG
    return normalizeKitchenLang(saved)
  } catch {
    return DEFAULT_KITCHEN_LANG
  }
}

export function saveKitchenLang(lang) {
  const normalized = normalizeKitchenLang(lang)
  try {
    globalThis.localStorage?.setItem(KITCHEN_LANG_STORAGE_KEY, normalized)
  } catch {
    /* ignore storage restrictions */
  }
  return normalized
}

/**
 * Resolve all displayable photos for a menu item (plated, prep, detail).
 * Always returns an array of valid image URLs/paths.
 */
export function getItemImages(menuItem) {
  if (!menuItem) return []
  const primary = typeof menuItem.imageUrl === 'string' ? menuItem.imageUrl.trim() : ''
  const extra = Array.isArray(menuItem.images)
    ? menuItem.images.map((u) => String(u || '').trim()).filter(Boolean)
    : []
  const fallback = DEFAULT_DISH_GALLERY[menuItem.id] || []
  const combined = [...new Set([primary, ...extra, ...fallback].filter(Boolean))]
  return combined
}

export const KITCHEN_TRANSLATIONS = {
  km: {
    langName: 'ភាសាខ្មែរ',
    languageLabel: 'ភាសា',
    liveDisplay: (mins) => `ផ្ទាំងបង្ហាញផ្ទះបាយផ្ទាល់ · គោលដៅ ${mins}:00`,
    title: 'ផ្ទះបាយ',
    subtitle: 'ផ្តល់អាទិភាពដល់វិក្កយបត្រកំពុងចម្អិន តាមដានពេលវេលារៀបចំ និងរក្សាសេវាកម្មឱ្យរលូន។',
    lateOnly: 'តែម្ហូបយឺតប៉ុណ្ណោះ',
    showingLateOnly: 'កំពុងបង្ហាញតែម្ហូបយឺត',
    eightySixBoard: (count) => `តារាងម្ហូបអស់ (86) · ${count}`,
    dishGalleryBtn: (count) => `រូបភាពមុខម្ហូប · ${count}`,
    firedNow: 'កំពុងចម្អិនឥឡូវនេះ',
    latePct: (pct) => `យឺតពេល · ${pct}%`,
    avgAge: 'រយៈពេលមធ្យម',
    bumpedToday: 'ធ្វើរួចថ្ងៃនេះ',
    ageLabel: {
      'on-time': 'ទាន់ពេល',
      warning: 'ជិតដល់ម៉ោង',
      late: 'យឺតពេល',
    },
    stations: {
      all: 'គ្រប់ផ្នែកទាំងអស់',
      grill: 'ផ្នែកអាំង',
      saute: 'ផ្នែកឆា',
      pantry: 'ផ្នែកញាំ និងភេសជ្ជៈ',
      dessert: 'ផ្នែកបង្អែម',
      expo: 'ផ្នែកត្រួតពិនិត្យ',
    },
    wholeTable: 'ពេញមួយតុ',
    noLateTickets: 'គ្មានវិក្កយបត្រយឺតនៅទីនេះទេ។',
    allClear: 'រួចរាល់ទាំងអស់។',
    firedAt: (clock) => `ដាក់ចម្អិនម៉ោង ${clock}`,
    newBadge: 'ថ្មី',
    compBadge: 'ឥតគិតថ្លៃ',
    bumpItem: (name) => `ធ្វើរួច · ${name}`,
    bumpAll: (count) => `ធ្វើរួចទាំងអស់ (${count})`,
    recallHeader: 'ទើបតែធ្វើរួច · ចុចដើម្បីហៅមកវិញ (ក្នុងរយៈពេល 60 វិនាទី)',
    eightySixedNow: (count) => `ម្ហូបអស់ពីស្តុកឥឡូវនេះ (86) · ${count}`,
    fullMenuAvailable: 'មុខម្ហូបមានគ្រប់ទាំងអស់។ ផ្នែកលក់អាចលក់បានគ្រប់មុខ។',
    floorSuggests: (name) => `ណែនាំម្ហូបជំនួស៖ ${name}`,
    noSubstitute: 'គ្មានម្ហូបជំនួស — ផ្នែកលក់ឃើញអស់ពីស្តុក (86)',
    backOn: 'ដាក់លក់វិញ',
    stockOutsHittingRecipes: 'គ្រឿងផ្សំអស់ពីស្តុកប៉ះពាល់ដល់មុខម្ហូប៖ ',
    receivingLandsStep5: ' (ទទួលទំនិញចូលស្តុកនៅជំហានទី 5)',
    eightySixADish: 'បិទមុខម្ហូបដែលអស់ (86) · បង្ហាញទៅផ្នែកលក់ភ្លាមៗ',
    tapTo86: 'ចុចដើម្បីបិទ (86)',
    galleryTitle: 'វិចិត្រសាលរូបភាពមុខម្ហូបក្នុងផ្ទះបាយ',
    gallerySubtitle: 'បង្ហាញរូបភាពច្រើនជ្រុងសម្រាប់មុខម្ហូបនីមួយៗ (ដាក់ចាន ចម្អិន និងគ្រឿងផ្សំ)',
    photoViews: ['រូបភាពដាក់ចាន', 'កំពុងចម្អិន', 'គ្រឿងផ្សំលម្អិត'],
    photosCount: (count) => `${count} រូបភាព`,
    viewPhotos: 'មើលរូបភាពច្រើនទៀត',
    prepNotes: 'កំណត់ចំណាំការចម្អិន',
    ingredientsLabel: 'គ្រឿងផ្សំ',
    allergensLabel: 'អាឡែហ្ស៊ី',
    dietaryLabel: 'ប្រភេទអាហារ',
    availableStatus: 'មានលក់',
    unavailableStatus: 'អស់ពីស្តុក (86)',
    closeModal: 'បិទ',
    courses: {
      appetizer: 'ម្ហូបសម្រន់',
      main: 'ម្ហូបគោល',
      dessert: 'បង្អែម',
      drink: 'ភេសជ្ជៈ',
      side: 'ម្ហូបបន្ទាប់បន្សំ',
    },
    modifiers: {
      Rare: 'ឆ្អិនតិច',
      'Medium rare': 'ឆ្អិនមធ្យមតិច',
      Medium: 'ឆ្អិនមធ្យម',
      Well: 'ឆ្អិនល្អ',
      Ranch: 'ទឹកជ្រលក់រ៉ាញ់',
      Vinaigrette: 'ទឹកជ្រលក់វីណេហ្គ្រេត',
      'Blue cheese': 'ឈីសប៊្លូ',
      Buffalo: 'ទឹកជ្រលក់ហឹរ',
      BBQ: 'ទឹកជ្រលក់បាប៊ីឃ្យូ',
      'Garlic parm': 'ខ្ទឹមស និងឈីស',
    },
    dishes: {
      m_salad: { name: 'សាឡាត់បន្លែស្រស់', desc: 'បន្លែបៃតងស្រស់ ប៉េងប៉ោះ និងទឹកជ្រលក់ជម្រើសរបស់អ្នក។' },
      m_wings: { name: 'ស្លាបមាន់អាំង', desc: 'ស្លាបមាន់អាំងឈ្ងុយឆ្ងាញ់ ជ្រលក់ទឹកជ្រលក់តាមជម្រើស។' },
      m_soup: { name: 'ស៊ុបប្រចាំថ្ងៃ', desc: 'ស៊ុបក្តៅៗប្រចាំថ្ងៃ ចម្អិនថ្មីៗក្នុងផ្ទះបាយ។' },
      m_burger: { name: 'បឺហ្គឺរ រ៉េស្តូរ៉ា', desc: 'សាច់គោអាំង ឈីស នំប៉័ងប្រ៊ីយ៉ូស និងដំឡូងបារាំងបំពង។' },
      m_salmon: { name: 'ត្រីសាលម៉ុនអាំង', desc: 'ត្រីសាលម៉ុនអាំងស្បែកស្រួយ ជាមួយបន្លែស្រស់តាមរដូវ។' },
      m_chickenpasta: { name: 'ផាស្តាសាច់មាន់គ្រីម', desc: 'សាច់មាន់អាំងលើមីផាស្តាទឹកជ្រលក់គ្រីម។' },
      m_steak: { name: 'ស្តេកសាច់គោរីបអាយ', desc: 'ស្តេកសាច់គោរីបអាយអាំង ជាមួយដំឡូងបារាំងបំពង។' },
      m_fishchips: { name: 'ត្រីបំពង និងដំឡូងបារាំង', desc: 'ត្រីបំពងស្រួយ ជាមួយដំឡូងបារាំងពណ៌មាស និងក្រូចឆ្មារ។' },
      m_vegbowl: { name: 'ឈុតបន្លែសុខភាព', desc: 'ចានបន្លែបៃតងស្រស់ ប៉េងប៉ោះ និងទឹកជ្រលក់។' },
      m_cake: { name: 'នំខេកសូកូឡា', desc: 'នំខេកសូកូឡាដ៏ឈ្ងុយឆ្ងាញ់ រៀបចំថ្មីៗ។' },
      m_icecream: { name: 'ការ៉េម', desc: 'ការ៉េមត្រជាក់ចិត្ត ២ គ្រាប់។' },
      m_soda: { name: 'ទឹកក្រូចកំប៉ុង', desc: 'ទឹកក្រូចកំប៉ុងត្រជាក់។' },
      m_coffee: { name: 'កាហ្វេក្តៅ', desc: 'កាហ្វេឆុងថ្មីៗក្លិនឈ្ងុយ។' },
    },
    inventory: {
      inv_bun: 'នំប៉័ងបឺហ្គឺរ',
      inv_patty: 'សាច់គោបឺហ្គឺរ',
      inv_tomato: 'ប៉េងប៉ោះ',
      inv_lettuce: 'សាឡាត់',
      inv_cheese: 'ឈីសបន្ទះ',
      inv_fries: 'ដំឡូងបារាំង',
      inv_salmon: 'សាច់ត្រីសាលម៉ុន',
      inv_chicken: 'ទ្រូងមាន់',
      inv_pasta: 'មីផាស្តា',
      inv_cream: 'គ្រីម',
      inv_saladmix: 'បន្លែសាឡាត់ចម្រុះ',
      inv_dressing: 'ទឹកជ្រលក់សាឡាត់',
      inv_wings: 'ស្លាបមាន់',
      inv_steak: 'សាច់គោរីបអាយ',
      inv_cake: 'នំខេកសូកូឡា',
      inv_icecream: 'ការ៉េម',
      inv_soda: 'ទឹកក្រូចកំប៉ុង',
      inv_coffee: 'កាហ្វេ',
    },
  },
  en: {
    langName: 'English',
    languageLabel: 'Language',
    liveDisplay: (mins) => `Live kitchen display · SLA ${mins}:00`,
    title: 'Kitchen',
    subtitle: 'Prioritize fired tickets, monitor prep times, and keep service moving.',
    lateOnly: 'Late only',
    showingLateOnly: 'Showing late only',
    eightySixBoard: (count) => `86 board · ${count}`,
    dishGalleryBtn: (count) => `Dish photos · ${count}`,
    firedNow: 'Fired now',
    latePct: (pct) => `Late · ${pct}%`,
    avgAge: 'Avg age',
    bumpedToday: 'Bumped today',
    ageLabel: {
      'on-time': 'On time',
      warning: 'Warning',
      late: 'Late',
    },
    stations: {
      all: 'All stations',
      grill: 'Grill',
      saute: 'Sauté',
      pantry: 'Pantry',
      dessert: 'Dessert',
      expo: 'Expo',
    },
    wholeTable: 'whole table',
    noLateTickets: 'No late tickets here.',
    allClear: 'All clear.',
    firedAt: (clock) => `fired ${clock}`,
    newBadge: 'NEW',
    compBadge: 'COMP',
    bumpItem: (name) => `Bump ${name}`,
    bumpAll: (count) => `Bump all (${count})`,
    recallHeader: 'Just bumped · tap to recall (60s window)',
    eightySixedNow: (count) => `86'd now · ${count}`,
    fullMenuAvailable: 'Full menu available. Floor can sell everything.',
    floorSuggests: (name) => `Floor suggests ${name}`,
    noSubstitute: 'No substitute — floor sees 86 with no fallback',
    backOn: 'Back on',
    stockOutsHittingRecipes: 'Stock-outs hitting recipes: ',
    receivingLandsStep5: ' (receiving lands in step 5)',
    eightySixADish: '86 a dish · writes to floor instantly',
    tapTo86: 'tap to 86',
    galleryTitle: 'Kitchen item photo gallery',
    gallerySubtitle: 'Multiple reference photos per dish (plated, cooking prep, and ingredient close-up)',
    photoViews: ['Plated view', 'Cooking & prep', 'Ingredients & garnish'],
    photosCount: (count) => `${count} photos`,
    viewPhotos: 'View more photos',
    prepNotes: 'Prep notes',
    ingredientsLabel: 'Ingredients',
    allergensLabel: 'Allergens',
    dietaryLabel: 'Dietary',
    availableStatus: 'Available',
    unavailableStatus: "86'd",
    closeModal: 'Close',
    courses: {
      appetizer: 'appetizer',
      main: 'main',
      dessert: 'dessert',
      drink: 'drink',
      side: 'side',
    },
    modifiers: {},
    dishes: {},
    inventory: {},
  },
  zh: {
    langName: '中文',
    languageLabel: '语言',
    liveDisplay: (mins) => `厨房实时显示 · SLA ${mins}:00`,
    title: '厨房看板',
    subtitle: '优先处理已下单餐单，监控备餐时间，保持出餐顺畅。',
    lateOnly: '仅看超时',
    showingLateOnly: '正在显示超时餐单',
    eightySixBoard: (count) => `沽清看板 (86) · ${count}`,
    dishGalleryBtn: (count) => `菜品图库 · ${count}`,
    firedNow: '当前制作中',
    latePct: (pct) => `已超时 · ${pct}%`,
    avgAge: '平均用时',
    bumpedToday: '今日已出餐',
    ageLabel: {
      'on-time': '准时',
      warning: '即将超时',
      late: '已超时',
    },
    stations: {
      all: '全部档口',
      grill: '烧烤台 (Grill)',
      saute: '热炒台 (Sauté)',
      pantry: '冷菜饮品台',
      dessert: '甜品台',
      expo: '总控台 (Expo)',
    },
    wholeTable: '整桌汇总',
    noLateTickets: '此处无超时餐单。',
    allClear: '全部完成。',
    firedAt: (clock) => `下单于 ${clock}`,
    newBadge: '新单',
    compBadge: '赠送',
    bumpItem: (name) => `完成出餐 · ${name}`,
    bumpAll: (count) => `全部出餐 (${count})`,
    recallHeader: '刚刚出餐 · 点击撤回 (60秒内)',
    eightySixedNow: (count) => `当前已沽清 (86) · ${count}`,
    fullMenuAvailable: '所有菜品供应正常，前厅可正常售卖。',
    floorSuggests: (name) => `前厅推荐替换：${name}`,
    noSubstitute: '无替换菜品 — 前厅仅显示已沽清 (86)',
    backOn: '恢复供应',
    stockOutsHittingRecipes: '缺货原料影响的菜品：',
    receivingLandsStep5: ' (第5步进行收货入库)',
    eightySixADish: '标记菜品沽清 (86) · 实时同步至前厅',
    tapTo86: '点击沽清 (86)',
    galleryTitle: '厨房菜品多图参考',
    gallerySubtitle: '展示每道菜品的多角度图片（装盘成品、烹饪过程与食材细节）',
    photoViews: ['成品装盘', '烹饪过程', '食材细节'],
    photosCount: (count) => `${count} 张图片`,
    viewPhotos: '查看更多图片',
    prepNotes: '备餐说明',
    ingredientsLabel: '配方原料',
    allergensLabel: '过敏原',
    dietaryLabel: '饮食标签',
    availableStatus: '正常供应',
    unavailableStatus: '已沽清 (86)',
    closeModal: '关闭',
    courses: {
      appetizer: '前菜',
      main: '主菜',
      dessert: '甜品',
      drink: '饮品',
      side: '配菜',
    },
    modifiers: {
      Rare: '三分熟 (Rare)',
      'Medium rare': '五分熟 (Med Rare)',
      Medium: '七分熟 (Medium)',
      Well: '全熟 (Well)',
      Ranch: '牧场沙拉酱',
      Vinaigrette: '油醋汁',
      'Blue cheese': '蓝纹奶酪酱',
      Buffalo: '水牛城辣酱',
      BBQ: '烧烤酱 (BBQ)',
      'Garlic parm': '蒜香帕玛森',
    },
    dishes: {
      m_salad: { name: '招牌田园沙拉', desc: '爽脆生菜、番茄配自选沙拉酱，现点现拌。' },
      m_wings: { name: '香烤鸡翅', desc: '炭火烤翅，搭配自选风味酱汁。' },
      m_soup: { name: '每日例汤', desc: '主厨每日现熬热汤。' },
      m_burger: { name: '招牌牛肉汉堡', desc: '手打牛肉饼、切达奶酪、布里欧修面包配薯条。' },
      m_salmon: { name: '香煎三文鱼', desc: '脆皮三文鱼柳配时令蔬菜。' },
      m_chickenpasta: { name: '奶油鸡肉意面', desc: '香煎鸡胸肉配浓郁奶油意面。' },
      m_steak: { name: '肉眼牛排配薯条', desc: '炭烤肉眼牛排，静置五分钟锁汁，配金黄薯条。' },
      m_fishchips: { name: '炸鱼薯条', desc: '香脆炸鱼配金黄薯条与鲜柠檬。' },
      m_vegbowl: { name: '鲜蔬能量碗', desc: '新鲜绿叶蔬菜、番茄与特调酱汁。' },
      m_cake: { name: '浓郁巧克力蛋糕', desc: '醇厚巧克力蛋糕，现点装盘。' },
      m_icecream: { name: '经典双球冰淇淋', desc: '两球经典香滑冰淇淋。' },
      m_soda: { name: '冰镇汽水', desc: '冰镇罐装汽水。' },
      m_coffee: { name: '现磨咖啡', desc: '新鲜冲煮佐餐咖啡。' },
    },
    inventory: {
      inv_bun: '布里欧修面包',
      inv_patty: '6盎司牛肉饼',
      inv_tomato: '番茄',
      inv_lettuce: '生菜份',
      inv_cheese: '切达奶酪片',
      inv_fries: '薯条份',
      inv_salmon: '三文鱼柳',
      inv_chicken: '鸡胸肉',
      inv_pasta: '意面份',
      inv_cream: '淡奶油',
      inv_saladmix: '混合沙拉菜',
      inv_dressing: '沙拉酱',
      inv_wings: '鸡翅份',
      inv_steak: '10盎司肉眼牛排',
      inv_cake: '巧克力蛋糕片',
      inv_icecream: '冰淇淋球',
      inv_soda: '罐装汽水',
      inv_coffee: '咖啡粉份',
    },
  },
}

export function getKitchenDict(lang) {
  const code = normalizeKitchenLang(lang)
  return KITCHEN_TRANSLATIONS[code] || KITCHEN_TRANSLATIONS[DEFAULT_KITCHEN_LANG]
}

export function translateDishName(menuItem, lang) {
  if (!menuItem) return ''
  const dict = getKitchenDict(lang)
  return dict.dishes?.[menuItem.id]?.name || menuItem.name || ''
}

export function translateDishDesc(menuItem, lang) {
  if (!menuItem) return ''
  const dict = getKitchenDict(lang)
  return dict.dishes?.[menuItem.id]?.desc || menuItem.description || ''
}

export function translateCourse(course, lang) {
  const key = String(course || '').trim().toLowerCase()
  const dict = getKitchenDict(lang)
  return dict.courses?.[key] || course || ''
}

export function translateModifier(value, lang) {
  const dict = getKitchenDict(lang)
  return dict.modifiers?.[value] || value || ''
}

export function translateInventoryName(invItem, lang) {
  if (!invItem) return ''
  const dict = getKitchenDict(lang)
  return dict.inventory?.[invItem.id] || invItem.name || ''
}

export function translateTableName(name, lang) {
  const raw = String(name || '')
  const code = normalizeKitchenLang(lang)
  if (code === 'en') return raw
  const match = raw.match(/^Table\s+(\d+)$/i)
  if (match) {
    return code === 'km' ? `តុលេខ ${match[1]}` : `${match[1]}号桌`
  }
  return raw
}
