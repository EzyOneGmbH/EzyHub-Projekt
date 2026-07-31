declare module "@/ezy/EzyOneApp.jsx" {
  const App: React.ComponentType;
  export default App;
  // Phase 2 (2026-07-31): von der EzyAI-App (/ezyai) wiederverwendet
  export function AiVisibilityTab(props: { selectedClient: { id: string; name?: string; domain?: string } | null }): JSX.Element;
}
