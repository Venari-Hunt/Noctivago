// Owns the "record audio" dialog - captures from the default microphone via
// getUserMedia + MediaRecorder (webm/opus, the only format MediaRecorder
// actually produces in Chromium), and hands the raw bytes to
// library:addRecordedSound over IPC on Save, which transcodes to .wav via
// the bundled ffmpeg and imports it through the exact same addSound() path
// any other file goes through (see library.js). Same install-once /
// open-on-demand shape as WatchFolderDialog.js, though this only has one
// entry point (the toolbar "+" menu) so there's no reshow-behind logic to
// track.
//
// Electron blocks getUserMedia by default - main/index.js's
// grantMicrophonePermission() is what makes the permission prompt resolve
// instead of silently rejecting. If the OS itself has microphone access
// disabled for the app, getUserMedia still rejects; that surfaces here as a
// plain status message, not a crash.
let els = null
let mediaRecorder = null
let mediaStream = null
let chunks = []
let timerInterval = null
let recordStartTime = 0
let recordedBlob = null

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function resetState() {
  chunks = []
  recordedBlob = null
  els.timer.textContent = '0:00'
  els.indicator.classList.add('hidden')
  els.start.classList.remove('hidden')
  els.stop.classList.add('hidden')
  els.save.disabled = true
  els.status.textContent = ''
  els.name.value = ''
}

// Tears down the live capture (recorder + microphone tracks) regardless of
// why - Cancel, Save completing, or the dialog otherwise closing. Stopping
// the tracks (not just the recorder) is what actually releases the OS-level
// microphone indicator/lock, not just MediaRecorder.stop() alone.
function teardownCapture() {
  if (timerInterval != null) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    } catch {
      // already stopped/errored - nothing more to do
    }
  }
  mediaRecorder = null
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }
}

async function startRecording() {
  els.status.textContent = ''
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    els.status.textContent = `Couldn't access the microphone: ${err.message}`
    return
  }
  chunks = []
  mediaRecorder = new MediaRecorder(mediaStream)
  mediaRecorder.ondataavailable = (evt) => {
    if (evt.data.size > 0) chunks.push(evt.data)
  }
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(chunks, { type: 'audio/webm' })
    els.save.disabled = false
  }
  mediaRecorder.start()

  recordStartTime = performance.now()
  els.timer.textContent = '0:00'
  timerInterval = setInterval(() => {
    els.timer.textContent = formatTimer(performance.now() - recordStartTime)
  }, 250)

  els.indicator.classList.remove('hidden')
  els.start.classList.add('hidden')
  els.stop.classList.remove('hidden')
}

function stopRecording() {
  if (timerInterval != null) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  els.indicator.classList.add('hidden')
  els.stop.classList.add('hidden')
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }
}

async function saveRecording() {
  if (!recordedBlob) return
  els.save.disabled = true
  els.status.textContent = 'Saving…'
  const name = els.name.value.trim() || 'Recording'
  const buffer = await recordedBlob.arrayBuffer()
  try {
    await window.noctivago.library.addRecordedSound({ name, buffer })
    els.dialog.classList.add('hidden')
    document.dispatchEvent(new CustomEvent('library:recorded'))
  } catch (err) {
    els.status.textContent = `Save failed: ${err.message}`
    els.save.disabled = false
  }
}

export function installRecordDialog() {
  els = {
    dialog: document.getElementById('record-dialog'),
    start: document.getElementById('record-start'),
    stop: document.getElementById('record-stop'),
    timer: document.getElementById('record-timer'),
    indicator: document.getElementById('record-indicator'),
    name: document.getElementById('record-name'),
    status: document.getElementById('record-status'),
    cancel: document.getElementById('record-cancel'),
    save: document.getElementById('record-save')
  }

  els.start.addEventListener('click', startRecording)
  els.stop.addEventListener('click', stopRecording)
  els.save.addEventListener('click', saveRecording)
  els.cancel.addEventListener('click', () => {
    teardownCapture()
    els.dialog.classList.add('hidden')
  })
}

export function openRecordDialog() {
  teardownCapture()
  resetState()
  els.dialog.classList.remove('hidden')
}
