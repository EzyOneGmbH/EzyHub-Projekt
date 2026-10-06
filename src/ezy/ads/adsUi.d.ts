// Typ-Deklaration fuer das JSX-Modul.
import type React from "react";
export const chf: (v: number, dec?: number) => string;
export const zahl: (v: number) => string;
export const prozent: (v: number | null | undefined, dec?: number) => string;
export const faktor: (v: number | null | undefined, dec?: number) => string;
export const Karte: React.ComponentType<any>;
export const Abschnitt: React.ComponentType<any>;
export const DeltaChip: React.ComponentType<any>;
export const Pille: React.ComponentType<any>;
export const Segmente: React.ComponentType<any>;
export const TabellenRahmen: React.ComponentType<any>;
export const th: (rechts?: boolean, extra?: object) => React.CSSProperties;
export const td: (rechts?: boolean, extra?: object) => React.CSSProperties;
