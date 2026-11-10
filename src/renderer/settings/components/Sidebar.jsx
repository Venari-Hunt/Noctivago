import { MockIcon } from '../../components/mockIcons.jsx'

// The list of Settings pages (the mock's .subnav): an icon and a name each.
export function Sidebar({ pages, activeId, onSelect }) {
  return (
    <nav className="subnav" aria-label="Settings">
      {pages.map((page) => (
        <button key={page.id} type="button" className={page.id === activeId ? 'cur' : ''} onClick={() => onSelect(page.id)}>
          <MockIcon name={page.icon} />
          {page.title}
        </button>
      ))}
    </nav>
  )
}
