// ─── Guest menu concierge ──────────────────────────────────────────
// An "ask about the menu" sheet for the QR guest page and the Telegram mini
// app. Read-only and menu-scoped: the question goes to /api/ai/chat with
// scope:'menu', and the server pins that scope for any unauthenticated caller
// no matter what is sent — so a guest can never read sales, stock, or staff.
// Without a configured AI key the sheet says so up front and the plain menu is
// untouched.

import { useEffect, useRef, useState } from 'react'
import { Sheet } from './ui'
import { aiChat, aiStatus } from '../lib/ai-client'

const COPY = {
  title: { en: 'Ask about the menu', km: 'សួរអំពីមុខម្ហូប', zh: '咨询菜单' },
  intro: {
    en: 'Ask me what to eat. I can recommend dishes and explain ingredients, allergens, spice, and prices.',
    km: 'សួរខ្ញុំថាគួរញ៉ាំអ្វី។ ខ្ញុំអាចណែនាំមុខម្ហូប និងពន្យល់អំពីគ្រឿងផ្សំ អាឡែស៊ី កម្រិតហិរស និងតម្លៃ។',
    zh: '问我该吃什么。我可以推荐菜品，并说明配料、过敏原、辣度和价格。',
  },
  placeholder: { en: 'Ask what to eat…', km: 'សួរថាគួរញ៉ាំអ្វី…', zh: '问问吃什么…' },
  send: { en: 'Send', km: 'ផ្ញើ', zh: '发送' },
  thinking: { en: 'Thinking…', km: 'កំពុងគិត…', zh: '思考中…' },
  empty: {
    en: 'Not sure what to order? Tap a suggestion or type your own.',
    km: 'មិនដឹងជ្រើសអ្វី? ចុចលើជម្រើស ឬវាយសំណួររបស់អ្នក។',
    zh: '不知道点什么？点一个建议，或直接输入你的问题。',
  },
  offline: {
    en: 'The menu assistant is offline right now — ask your server.',
    km: 'ជំនួយការមុខម្ហូបកំពុងអត់បណ្ដោះអាសន្ន — សួរបុគ្គលិករបស់អ្នក។',
    zh: '菜单助手暂时离线，请询问服务员。',
  },
  busy: {
    en: 'That’s a lot of questions at once — give me a moment and try again.',
    km: 'សំណួរច្រើនពេកក្នុងពេលតែមួយ — រង់ចាំបន្តិច ហើយព្យាយាមម្តងទៀត។',
    zh: '一次问得太多了——请稍后再试。',
  },
  footer: { en: 'Answers come from this menu only.', km: 'ចម្លើយមកពីមុខម្ហូបនេះប៉ុណ្ណោះ។', zh: '回答仅来自本菜单。' },
  prompts: [
    { en: 'Recommend something', km: 'ណែនាំមុខម្ហូបមួយ', zh: '推荐一道菜' },
    { en: 'What’s popular?', km: 'ម្ហូបណាពេញនិយម?', zh: '哪些最受欢迎？' },
    { en: 'Anything vegetarian?', km: 'មានមុខម្ហូបបួសទេ?', zh: '有素食吗？' },
    { en: 'What’s spicy?', km: 'ម្ហូបណាហិរស?', zh: '哪些菜辣？' },
    { en: 'Gluten-free options?', km: 'មុខម្ហូបគ្មាន gluten?', zh: '有无麸质选项？' },
    { en: 'Desserts?', km: 'បង្អែម?', zh: '有什么甜点？' },
  ],
}

const pick = (entry, lang) => entry?.[lang] || entry?.en || ''

export default function MenuConcierge({ lang = 'en', locId = null, onClose }) {
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState('') // '', 'offline', 'busy'
  const [ready, setReady] = useState(null) // null = checking, true = AI on
  const nextId = useRef(0)
  const listRef = useRef(null)

  useEffect(() => {
    let alive = true
    aiStatus().then((status) => {
      if (!alive) return
      setReady(Boolean(status?.configured))
      if (!status?.configured) setNote('offline')
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, pending])

  const disabled = pending || ready === false

  async function ask(question) {
    if (!question || disabled) return false
    nextId.current += 1
    setMessages((prev) => [...prev, { id: `m${nextId.current}`, role: 'user', content: question }])
    setPending(true)
    setNote('')
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    const res = await aiChat({ question, history, lang, scope: 'menu', locId: locId || undefined })
    setPending(false)
    if (res.ok && res.reply) {
      nextId.current += 1
      setMessages((prev) => [...prev, { id: `m${nextId.current}`, role: 'assistant', content: res.reply }])
      return true
    }
    setNote(res.status === 429 ? 'busy' : 'offline')
    return false
  }

  async function submit(event) {
    event.preventDefault()
    const input = event.currentTarget.elements.question
    const question = input.value.trim()
    if (!question) return
    input.value = ''
    const ok = await ask(question)
    if (!ok) input.value = question // don't lose what they typed
  }

  return (
    <Sheet onClose={onClose} label={pick(COPY.title, lang)}>
      <div className="px-1 pb-2">
        <div className="text-xs font-bold uppercase tracking-widest text-amber-700">✨ {pick(COPY.title, lang)}</div>
        <h2 className="text-xl font-extrabold">{pick(COPY.title, lang)}</h2>
        <p className="mt-1 text-sm text-stone-500">{pick(COPY.intro, lang)}</p>

        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label={pick(COPY.title, lang)}
          className="mt-4 max-h-[46vh] min-h-[120px] space-y-2 overflow-y-auto rounded-2xl bg-stone-50 p-3"
        >
          {messages.length === 0 && ready !== false && (
            <p className="px-1 py-2 text-sm text-stone-500">{pick(COPY.empty, lang)}</p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[92%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-snug ${
                message.role === 'user'
                  ? 'ml-auto bg-stone-900 text-white'
                  : 'bg-white text-stone-800 shadow-sm'
              }`}
            >
              {message.content}
            </div>
          ))}
          {pending && (
            <div className="max-w-[92%] rounded-2xl bg-white px-3 py-2 text-sm italic text-stone-400 shadow-sm" role="status">
              {pick(COPY.thinking, lang)}
            </div>
          )}
        </div>

        {note && (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${note === 'busy' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-600'}`}
            data-testid="menu-concierge-note"
          >
            {note === 'busy' ? pick(COPY.busy, lang) : pick(COPY.offline, lang)}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {COPY.prompts.map((prompt) => (
            <button
              key={prompt.en}
              type="button"
              disabled={disabled}
              onClick={() => ask(pick(prompt, lang))}
              className="min-h-[36px] rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-40"
            >
              {pick(prompt, lang)}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            name="question"
            aria-label={pick(COPY.placeholder, lang)}
            placeholder={pick(COPY.placeholder, lang)}
            disabled={disabled}
            className="min-h-[44px] flex-1 rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:bg-stone-50"
          />
          <button
            type="submit"
            disabled={disabled}
            className="min-h-[44px] shrink-0 rounded-2xl bg-stone-900 px-4 text-sm font-extrabold text-white transition hover:bg-stone-800 disabled:opacity-40"
          >
            {pick(COPY.send, lang)}
          </button>
        </form>

        <p className="mt-2 text-2xs text-stone-400">{pick(COPY.footer, lang)}</p>
      </div>
    </Sheet>
  )
}
