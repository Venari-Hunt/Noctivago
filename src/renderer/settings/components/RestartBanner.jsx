export function RestartBanner({ onRestart }) {
  return (
    <div className="plugin-store-restart">
      <span>Restart Noctívago to apply your plugin changes.</span>
      <button className="btn btn-small btn-primary" type="button" onClick={onRestart}>Restart now</button>
    </div>
  )
}
