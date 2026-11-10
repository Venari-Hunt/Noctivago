// One card on a Settings page: a quiet title, then its rows.
export function Group({ title, hint, children }) {
  return (
    <section className="card">
      <h2 className="gh l">{title}</h2>
      {hint && <p className="settings-page-hint">{hint}</p>}
      {children}
    </section>
  )
}
