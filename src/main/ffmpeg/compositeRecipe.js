// A Composite recipe keeps every layer, including muted ones (`muted: true`);
// the bake renders only the layers that are not muted. An older recipe has no
// `muted` field, so every layer in it is baked.
export function bakedMembers(members) {
  return members.filter((m) => m.muted !== true)
}
