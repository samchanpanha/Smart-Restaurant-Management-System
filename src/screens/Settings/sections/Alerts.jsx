import { NOTIFICATION_CHANNELS } from '../../../lib/settings'
import { Field, Toggle, Card, inputCls } from '../primitives'

function AlertsSection({ draft, patch }) {
  const notifications = draft.notifications
  function setNotifications(key, value) {
    patch({ notifications: { ...notifications, [key]: value } })
  }
  return (
    <Card title="What pings whom" sub="Alert classes surface in the bell, on tabs, and in the shift rail.">
      <div className="grid gap-2 md:grid-cols-2">
        <Toggle label="Low stock & out-of-stock" checked={notifications.lowStock} onChange={(value) => setNotifications('lowStock', value)} />
        <Toggle label="Late tickets (KDS SLA)" checked={notifications.lateTickets} onChange={(value) => setNotifications('lateTickets', value)} />
        <Toggle label="Guest requests (call server, bill)" checked={notifications.guestRequests} onChange={(value) => setNotifications('guestRequests', value)} />
        <Toggle label="Loss-making dishes" checked={notifications.negativeMargin} onChange={(value) => setNotifications('negativeMargin', value)} />
        <Toggle label="Daily digest" hint="Yesterday's sales, food cost, and exceptions." checked={notifications.dailyDigest} onChange={(value) => setNotifications('dailyDigest', value)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Digest time">
          <input type="time" value={notifications.digestTime} onChange={(e) => setNotifications('digestTime', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Channel">
          <select value={notifications.channel} onChange={(e) => setNotifications('channel', e.target.value)} className={inputCls}>
            {NOTIFICATION_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Recipients" hint="Comma-separated emails or phone numbers.">
          <input value={notifications.recipients} onChange={(e) => setNotifications('recipients', e.target.value)} maxLength={200} className={inputCls} placeholder="owner@restora.example" />
        </Field>
        <Field label="Webhook URL" hint="Optional — posts alert JSON for Slack or a custom bot.">
          <input value={notifications.webhookUrl} onChange={(e) => setNotifications('webhookUrl', e.target.value)} maxLength={200} className={inputCls} placeholder="https://hooks.example/restora" />
        </Field>
      </div>
    </Card>
  )
}

// ─── Data & backup ─────────────────────────────────────────────────


export { AlertsSection }
