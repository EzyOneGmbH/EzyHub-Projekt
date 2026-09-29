import type { ComponentType } from "react";

export const EzyAiAgencyTable: ComponentType<{
  mode?: "organic" | "ads";
  clients: Array<{ id: string; name?: string | null; domain?: string | null }>;
  dateRange: {
    start: Date | string;
    end: Date | string;
    compare?: { start: Date | string; end: Date | string } | null;
    compareMode?: string | null;
  };
  onSelect?: (clientId: string) => void;
  onCompareMode?: ((mode: "prevPeriod") => void) | null;
}>;
