// One Obsidian-style settings line: name + description on the left, the
// control on the right.
export function SettingItem({ name, description, children }) {
  return (
    <div className="settings-item">
      <div className="settings-item-info">
        <div className="settings-item-name">{name}</div>
        {description && <div className="settings-item-desc">{description}</div>}
      </div>
      <div className="settings-item-control">{children}</div>
    </div>
  )
}
