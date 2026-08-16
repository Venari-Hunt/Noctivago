// Wires the toolbar's gear button + Settings modal. Core, not a plugin -
// mirrors the other app-wide bits (dev badge, slider reset) wired directly
// from main.js rather than living inside a tab.
export function installSettingsMenu() {
  const openBtn = document.getElementById('open-settings')
  const modal = document.getElementById('settings-modal')
  const closeBtn = document.getElementById('settings-close')
  const autoUpdateCheckbox = document.getElementById('settings-auto-update-enabled')
  const checkNowBtn = document.getElementById('settings-check-now')
  const checkStatus = document.getElementById('settings-check-status')

  openBtn.addEventListener('click', async () => {
    const settings = await window.noctivago.settings.get()
    autoUpdateCheckbox.checked = settings.autoUpdateEnabled
    checkStatus.textContent = ''
    modal.classList.remove('hidden')
  })

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'))

  autoUpdateCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setAutoUpdateEnabled(autoUpdateCheckbox.checked)
  })

  checkNowBtn.addEventListener('click', () => {
    // The actual result (update found / already up to date / check failed)
    // surfaces as a native dialog from the main process - same as every
    // other update-related prompt in this app - so this status line is
    // just a lightweight "yes, it's running" acknowledgement, not the
    // final answer.
    checkStatus.textContent = 'Checking…'
    window.noctivago.autoUpdate.checkNow()
    setTimeout(() => {
      checkStatus.textContent = ''
    }, 3000)
  })
}
