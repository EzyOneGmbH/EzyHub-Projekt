## EZY ONE TOOL — Team-Tool mit Backend & KI

Ein Business-Team-Tool mit Login, gemeinsamer Datenbank und KI-Funktionen. Backend läuft über Lovable Cloud (Datenbank + Auth + Edge Functions + Secrets); KI über das Lovable AI Gateway.

### Kernfunktion (Vorschlag)

Kombiniertes **Kunden- & Aufgaben-Management** — die meistgenutzte Basis für Team-Tools, modular erweiterbar:

- **Kunden**: Name, Firma, E-Mail, Telefon, Notizen
- **Aufgaben**: Titel, Beschreibung, Status (Offen/In Arbeit/Erledigt), Priorität, Fälligkeit, Zuweisung an Teammitglied, optional an Kunde gekoppelt
- **Notizen**: Freie Textnotizen pro Kunde/Aufgabe
- **Dashboard**: Übersicht über offene Aufgaben, fällige Termine, letzte Kunden

### Rollen

- **Admin**: alles verwalten, Nutzer/Rollen ändern
- **Mitglied**: Kunden & Aufgaben sehen/bearbeiten

Rollen liegen in eigener Tabelle `user_roles` (Sicherheits-Best-Practice).

### KI-Funktionen (über Edge Function + Lovable AI Gateway)

1. **Notiz/Beschreibung zusammenfassen** — Button an langen Texten
2. **Aufgabenvorschläge** — KI schlägt aus einer Kundennotiz nächste Tasks vor
3. **Smart-Suche / Q&A** — Frage stellen ("Welche Aufgaben sind diese Woche fällig für Kunde X?"), KI antwortet mit App-Daten

### Seiten

- `/login`, `/signup` — E-Mail + Passwort
- `/` — Dashboard (geschützt)
- `/customers`, `/customers/$id` — Kundenliste & Detail
- `/tasks`, `/tasks/$id` — Aufgabenliste & Detail
- `/admin/users` — Nutzer- & Rollenverwaltung (nur Admin)

### Backend-Setup (Lovable Cloud)

**Tabellen** (alle mit RLS):
- `profiles` (id → auth.users, full_name, avatar_url) — Auto-Trigger bei Signup
- `user_roles` (user_id, role: admin|member) + `has_role()` Security-Definer-Funktion
- `customers` (id, name, company, email, phone, notes, created_by, timestamps)
- `tasks` (id, title, description, status, priority, due_date, assigned_to, customer_id, created_by, timestamps)
- `notes` (id, content, customer_id?, task_id?, created_by, created_at)

**RLS-Regeln**: alle eingeloggten Nutzer können lesen/schreiben; nur Admins ändern Rollen; nur Ersteller oder Admin können löschen.

**Auth**: E-Mail + Passwort, mit `/reset-password`-Seite. Auto-Confirm aktiviert für schnelles Testen.

**Edge Functions**:
- `ai-summarize` — fasst Text zusammen
- `ai-suggest-tasks` — schlägt Tasks aus Notiz vor
- `ai-chat` — Streaming-Chat mit Kontext aus DB

**Secrets**: `LOVABLE_API_KEY` (auto-bereitgestellt für AI Gateway).

### Design

Modernes, klares Light/Dark-Theme mit dezentem Akzent (Indigo/Blau), Sidebar-Navigation links, kartenbasierte Listen, responsive für Mobile.

### Out of Scope (v1)

- Datei-Uploads (kann später ergänzt werden)
- Externe Integrationen (E-Mail-Versand, Kalender)
- Bezahlung/Abo

### Technische Hinweise

- TanStack Start, file-based Routing, geschützte Routen via `_authenticated` Layout
- Server Functions für DB-Zugriffe mit `requireSupabaseAuth`
- KI-Calls ausschließlich aus Edge Functions, nie vom Client
- Rollen werden serverseitig mit `has_role(auth.uid(), 'admin')` geprüft
