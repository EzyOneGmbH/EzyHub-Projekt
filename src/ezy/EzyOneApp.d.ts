declare module "@/ezy/EzyOneApp.jsx" {
  // Phase 3 (2026-07-31): appScope macht den Monolithen zur App-Engine
  // (seo|ads|reakt|admin); ohne Scope = Legacy-Vollansicht (nur noch Viewer).
  const App: React.ComponentType<{ appScope?: string | null }>;
  export default App;
  // Phase 2 (2026-07-31): von der EzyAI-App (/ezyai) wiederverwendet
  export function AiVisibilityTab(props: { selectedClient: { id: string; name?: string; domain?: string } | null }): JSX.Element;
}
