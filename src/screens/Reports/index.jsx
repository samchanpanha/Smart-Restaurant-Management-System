import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { buildReportDocument, printHtml, renderDocumentHtml } from '../../lib/documents'
import { useI18n } from '../../lib/i18n'
import { sanitizeSettings } from '../../lib/settings'
import { useRestora } from '../../lib/store'
import { TABS, RANGES } from './shared.js'
import { SavedViews } from './sections/SavedViews.jsx'
import { SalesReport } from './sections/SalesReport.jsx'
import { ServiceReport } from './sections/ServiceReport.jsx'
import { VoidsReport } from './sections/VoidsReport.jsx'
import { VarianceReport } from './sections/VarianceReport.jsx'
import { PnlReport } from './sections/PnlReport.jsx'
import { SellBuyReport } from './sections/SellBuyReport.jsx'
import { ProfitLossReport } from './sections/ProfitLossReport.jsx'
import { BuyingReport } from './sections/BuyingReport.jsx'
import { StockFlowReport } from './sections/StockFlowReport.jsx'
import { TopLowReport } from './sections/TopLowReport.jsx'
import { DeliveryReport } from './sections/DeliveryReport.jsx'

function ReportsScreen() {
  const { state } = useRestora()
  const { lang, dict } = useI18n()
  const rep = dict.reports || {}
  const [tab, setTab] = useState('sales')
  const [range, setRange] = useState('tonight')

  // The printed report is the same aggregation the screen shows — just on
  // paper, with the location's report template and currency.
  function printReport() {
    const settings = sanitizeSettings(state.settings, state.settings?.restaurantName)
    const doc = buildReportDocument({ shop: { ...state, settings }, settings, range })
    printHtml(renderDocumentHtml(doc, settings, {}), { title: `${doc.title} ${range}` })
  }

  const rangeLabels = {
    tonight: lang === 'km' ? 'យប់នេះ' : lang === 'zh' ? '今晚' : 'Tonight',
    '7d': lang === 'km' ? '៧ ថ្ងៃ' : lang === 'zh' ? '7 天' : '7 days',
    '30d': lang === 'km' ? '៣០ ថ្ងៃ' : lang === 'zh' ? '30 天' : '30 days',
  }

  const reportTabLabels = {
    sales: rep.salesTab || 'Sales',
    buying: rep.buyingTab || (lang === 'km' ? 'ការទិញចូល' : lang === 'zh' ? '采购进货' : 'Buying'),
    stockflow: rep.stockflowTab || (lang === 'km' ? 'ចលនាស្តុក' : lang === 'zh' ? '库存流向' : 'Stock flow'),
    pl: lang === 'km' ? 'ចំណេញ និងខាត' : lang === 'zh' ? '损益表' : 'Profit & loss',
    sellbuy: lang === 'km' ? 'លក់ និងទិញ ចូល/ចេញ' : lang === 'zh' ? '销售与采购进出' : 'Sell & buy in/out',
    toplow: lang === 'km' ? 'លក់ដាច់បំផុត និងតិចបំផុត' : lang === 'zh' ? '畅销与滞销' : 'Top & bottom',
    service: rep.serviceTab || 'Service',
    voids: rep.voidsTab || 'Voids & comps',
    variance: rep.varianceTab || 'Variance',
    pnl: rep.pnlTab || 'P&L-lite',
    delivery: lang === 'km' ? 'ការដឹកជញ្ជូន' : lang === 'zh' ? '配送表现' : 'Delivery',
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">{rep.kicker || 'Business overview'}</div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            {rep.title || 'Reports & Analytics'}
            {lang !== 'en' && <span className="sr-only"> Reports &amp; Analytics</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{rep.subtitle || 'Turn sales, service, and cost signals into the next best action.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={printReport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
        >
          <Icon name="printer" size={16} />
          {rep.printReport || 'Print report'}
          {lang !== 'en' && <span className="sr-only"> Print report</span>}
        </button>
        <div className="flex gap-1 rounded-xl bg-[var(--color-ink-900)] p-1 ring-1 ring-inset ring-[var(--color-ink-700)]" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold ${range === r.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {rangeLabels[r.id] || r.label}
              {lang !== 'en' && <span className="sr-only"> {r.label}</span>}
            </button>
          ))}
        </div>
        <SavedViews current={{ tab, range }} onApply={(view) => { if (view.tab) setTab(view.tab); if (view.range) setRange(view.range) }} />
        </div>
      </header>

      <p className="text-xs text-zinc-500">
        Sell &amp; buy, Profit &amp; loss and Top &amp; bottom read from the movement ledger for the selected range;
        Service, Voids, Variance and P&amp;L-lite read tonight&apos;s live orders.
      </p>

      <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-[var(--color-ink-900)] p-1.5 ring-1 ring-inset ring-[var(--color-ink-700)]" role="tablist" aria-label="Reports">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {reportTabLabels[t.id] || t.label}
            {lang !== 'en' && <span className="sr-only"> {t.label}</span>}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesReport range={range} />}
      {tab === 'buying' && <BuyingReport range={range} />}
      {tab === 'stockflow' && <StockFlowReport range={range} />}
      {tab === 'pl' && <ProfitLossReport range={range} />}
      {tab === 'sellbuy' && <SellBuyReport range={range} />}
      {tab === 'toplow' && <TopLowReport range={range} />}
      {tab === 'service' && <ServiceReport />}
      {tab === 'voids' && <VoidsReport />}
      {tab === 'variance' && <VarianceReport />}
      {tab === 'pnl' && <PnlReport />}
      {tab === 'delivery' && <DeliveryReport range={range} />}
    </div>
  )
}

export default ReportsScreen
