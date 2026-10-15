import {
  ArrowLeftRight,
  Armchair,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Check,
  ChefHat,
  ChevronDown,
  CircleDollarSign,
  Clock,
  FileText,
  Image,
  Layers,
  LayoutDashboard,
  LayoutList,
  LineChart,
  Lock,
  Pin,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Trash2,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'

// The app's icon vocabulary, now backed by lucide-react (tree-shaken) behind
// the same <Icon name> API the screens already use. Add a name here rather
// than importing lucide directly in screens.
const ICONS = {
  dashboard: LayoutDashboard,
  orders: ReceiptText,
  tables: Armchair,
  kitchen: ChefHat,
  inventory: Boxes,
  menu: UtensilsCrossed,
  costing: CircleDollarSign,
  reports: BarChart3,
  settings: Settings,
  search: Search,
  bell: Bell,
  chevron: ChevronDown,
  catalog: LayoutList,
  supplier: Store,
  layers: Layers,
  printer: Printer,
  doc: FileText,
  cart: ShoppingCart,
  swap: ArrowLeftRight,
  send: Send,
  photo: Image,
  wallet: Wallet,
  chart: LineChart,
  trash: Trash2,
  check: Check,
  clock: Clock,
  lock: Lock,
  plus: Plus,
  pin: Pin,
  users: Users,
  shield: ShieldCheck,
  building: Building2,
  warning: TriangleAlert,
}

export function Icon({ name, size = 20, className = '', strokeWidth = 1.8, ...props }) {
  const Glyph = ICONS[name]
  if (!Glyph && import.meta.env?.DEV) {
    console.warn(`[Icon] unknown icon name: ${name}`)
  }
  const Cmp = Glyph || LayoutDashboard
  return <Cmp aria-hidden="true" size={size} strokeWidth={strokeWidth} className={className} {...props} />
}
