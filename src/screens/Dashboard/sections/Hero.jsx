import heroPhoto from '../../../assets/restora-hero.jpg'

// The always-dark greeting panel. Kept on a literal near-black base (not a
// theme token) because it is a photo card that must read the same under the
// light workspace and the dark sidebar.
export default function Hero({ copy, greeting, date, locationName, restaurantName, roleLabel }) {
  return (
    <section
      className="relative isolate flex min-h-[220px] items-center overflow-hidden rounded-[var(--radius-2xl)] bg-[#121110] bg-cover bg-center px-7 py-8 text-white shadow-[var(--shadow-md)] sm:min-h-[250px] sm:px-9"
      style={{ backgroundImage: `linear-gradient(90deg, rgba(18,17,16,.82) 0%, rgba(18,17,16,.55) 42%, rgba(18,17,16,.05) 100%), url(${heroPhoto})` }}
    >
      <div className="max-w-xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-[var(--fs-caption)] font-semibold text-white/90 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> {copy.liveShift} · {restaurantName}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-[38px]">
          {greeting}, <span className="text-[var(--accent)]">{roleLabel}</span>
        </h1>
        <p className="mt-2 max-w-lg text-sm text-white/85 sm:text-base">{copy.heroSub}</p>
        <div className="mt-5 flex items-center gap-2 text-[var(--fs-label)] font-medium text-white/90">
          <span aria-hidden="true">▦</span>
          {date}
          <span className="mx-1 text-white/50">·</span>
          {locationName}
        </div>
      </div>
    </section>
  )
}
