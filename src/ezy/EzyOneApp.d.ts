declare module "@/ezy/EzyOneApp.jsx" {
  // Phase 3 (2026-07-31): appScope macht den Monolithen zur App-Engine
  // (seo|ads|reakt|admin); ohne Scope = Legacy-Vollansicht (nur noch Viewer).
  const App: React.ComponentType<{ appScope?: string | null }>;
  export default App;
  // Phase 2 (2026-07-31): von der EzyAI-App (/ezyai) wiederverwendet.
  // onReviewPrompts (18.08.): Sprung in den "Your Prompts"-Bereich.
  export function AiVisibilityTab(props: {
    selectedClient: { id: string; name?: string; domain?: string } | null;
    navStyle?: "sidebar" | "topbar";
    onReviewPrompts?: () => void;
  }): JSX.Element;
  // Typecheck-Fix (2026-08-18): diese Named-Exports existieren im .jsx längst —
  // die d.ts hatte sie nur nie deklariert (TS2614 in ezyai.tsx/ezyai-analyse.tsx).
  export function ToastProvider(props: { children?: React.ReactNode }): JSX.Element;
  export function EzyPilotProvider(props: {
    selectedClient?: unknown;
    clients?: unknown[];
    tools?: unknown[];
    children?: React.ReactNode;
  }): JSX.Element;
  export function EzyPilotPopup(): JSX.Element;
  export function EzyPilotButton(): JSX.Element;
}
