export function Sidebar({ groups, activeId, onSelect }) {
  return (
    <nav className="settings-sidebar">
      {groups.map((group) => (
        <div key={group.label} className="settings-sidebar-group">
          <div className="settings-sidebar-label">{group.label}</div>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-sidebar-item${item.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
