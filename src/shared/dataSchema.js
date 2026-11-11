// Version of the saved data's shape (library, presets, settings, community
// stores). Raise it ONLY for a change an older app cannot read: a renamed or
// removed field, a field whose meaning or type changed. Adding a field never
// raises it. Raising it makes a later downgrade restore the last snapshot
// written before the change (src/main/dataGuardCore.js), so work done in
// between is set aside, not lost, but not visible either. Rules in CLAUDE.md,
// "Data that survives a downgrade".
export const DATA_SCHEMA = 1
