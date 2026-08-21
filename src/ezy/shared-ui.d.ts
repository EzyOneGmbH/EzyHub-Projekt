// Typdeklarationen fuer die aus EzyOneApp extrahierte Shared-UI (18.08.2026).
// Bewusst praezise statt any — die .jsx-Implementierung bleibt JavaScript.
import type { ReactNode, ReactElement } from "react";

export declare function ToastProvider(props: { children: ReactNode }): ReactElement;
export declare function useToast(): (msg: string, type?: "info" | "success" | "error") => void;

export declare function Btn(props: {
  children?: ReactNode;
  onClick?: (e?: unknown) => void;
  variant?: string;
  size?: string;
  icon?: unknown;
  disabled?: boolean;
  [key: string]: unknown;
}): ReactElement;
export declare function Badge(props: { children?: ReactNode; color?: string }): ReactElement;

export declare function EzyPilotProvider(props: {
  selectedClient: { id: string; name?: string } | null;
  clients: Array<{ id: string; name?: string }>;
  tools: unknown[];
  children: ReactNode;
}): ReactElement;
export declare function EzyPilotPopup(): ReactElement | null;
export declare function EzyPilotButton(): ReactElement;
export declare function EzyPilotFab(props: { size?: number; elevated?: boolean }): ReactElement;
export declare function EzyPilotPage(props: {
  selectedClient: { id: string } | null;
}): ReactElement;
export declare function useEzyPilot(): {
  messages: unknown[];
  busy: boolean;
  send: (text: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
} | null;
