// Client uses template literal — must match app/api/todos/[id]/route.ts
export async function fetchTodo(id: string) {
  const res = await fetch(`/api/todos/${id}`, { method: "GET" });
  return res.json();
}

export async function deleteTodo(id: string) {
  const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
  return res.json();
}
