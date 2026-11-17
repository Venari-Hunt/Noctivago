import { MockIcon } from '../../components/mockIcons.jsx'

// The list of Settings pages (the mock's .subnav): an icon and a name each.
export function Sidebar({ pages, activeId, onSelect }) {
  return (
    <nav className="subnav" aria-label="Settings">
      {pages.map((page) => (
        <button key={page.id} type="button" className={page.id === activeId ? 'cur' : ''} title={page.title} aria-label={page.title} onClick={() => onSelect(page.id)}>
          <MockIcon name={page.icon} />
          <span>{page.title}</span>
        </button>
      ))}
    </nav>
  )
}
