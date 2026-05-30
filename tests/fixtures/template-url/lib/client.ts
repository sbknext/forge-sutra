// Template-literal fetch with no matching route — triggers orphaned_endpoint
// at template-prefix confidence (lower than static string literal orphans).

export async function fetchWidget(id: string) {
  const res = await fetch(`/api/widgets/${id}`, { method: "GET" });
  return res.json();
}
