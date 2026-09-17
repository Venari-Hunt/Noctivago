const MAX_PAGE_SIZE = 30

export function clampPageSize(pageSize, fallback){
    return Math.min(Math.max(Math.round(pageSize) || fallback, 1), MAX_PAGE_SIZE)
}