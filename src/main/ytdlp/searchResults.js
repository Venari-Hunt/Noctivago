export function parseYouTubeSearchResults(stdout, pageSize) {
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  const results = lines
    .map(parseLine)
    .filter(Boolean)
    .filter((result) => typeof result.duration === 'number' && result.duration > 0)
    .map(mapResult)

  return { results, hasMore: lines.length >= pageSize }
}

function parseLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function mapResult(result) {
  return {
    id: result.id,
    title: result.title || result.id,
    channel: result.channel || result.uploader || '',
    durationSeconds: result.duration,
    thumbnailUrl: result.thumbnails?.[0]?.url || null,
    description: result.description || '',
    url: result.webpage_url || result.url
  }
}
