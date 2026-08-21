# WordPress-Secrets: Schlüssel, Migration, Rotation, Rollback

Stand: 21.08.2026 (Security-Runde 2). Betrifft die Application Passwords der
WordPress-Connectoren (`oauth_connections.access_token`, provider `wordpress`).

## Schlüssel-Modell

| Version | Quelle | Zweck |
|---|---|---|
| `w1`–`w9` | `WP_SECRET_KEY_V1`–`V9` (Lovable-Env, beliebiger langer Zufallswert) | **Dauerhafte, dedizierte Schlüssel.** Neue Secrets nutzen automatisch die höchste w-Version. |
| `v1` | HKDF aus `ADMIN_AUTOMATION_SECRET` | **Nur noch Lese-Legacy** (Bestand vor Runde 2). Sobald ein `WP_SECRET_KEY_V*` gesetzt ist, wird nie mehr mit v1 verschlüsselt. |

Ciphertext-Format: `enc:<version>:<iv>:<tag>:<ct>` (AES-256-GCM, base64url).
Klartexte werden nie geloggt und nie an den Browser gegeben; der Admin sieht
ausschliesslich Zähler (`GET /api/admin/secret-status`, owner/admin).

## Migration auf den dedizierten Schlüssel (einmalig)

1. In Lovable ein Projekt-Secret setzen: `WP_SECRET_KEY_V1=<z.B. openssl rand -base64 48>`
   (Wert nirgendwo sonst ablegen; ein Verlust ist per Rotation heilbar, solange
   der alte Schlüssel noch lesbar ist.)
2. Deploy abwarten, dann Bestand umschlüsseln (idempotent, Antwort nur Zähler):
   `curl -X POST https://ezyhub.ch/api/admin/secure-migrate -H "Authorization: Bearer $ADMIN_AUTOMATION_SECRET"`
3. Kontrolle: `GET /api/admin/secret-status` → `veraltet=0`, `klartext=0`,
   alles `aktuell` — oder im Admin unter Einstellungen → API-Schlüssel.
4. **Klartext-Fallback deaktivieren** (empfohlen, erst NACH Schritt 3):
   `WP_SECRETS_STRICT=1` setzen. Ab dann wird ein unverschlüsselter Wert beim
   Lesen verweigert statt durchgereicht (fail-closed).

Bestehende WordPress-Verbindungen bleiben während der gesamten Migration
nutzbar: v1-Ciphertexte sind weiterhin lesbar, bis sie umgeschlüsselt sind.

## Key-Rotation (w1 → w2 → …)

1. `WP_SECRET_KEY_V2` setzen (den alten `V1` NICHT entfernen).
2. `POST /api/admin/secure-migrate` — Bestand wird auf `w2` umgeschlüsselt.
3. `secret-status` prüfen (`veraltet=0`).
4. Erst danach darf `WP_SECRET_KEY_V1` entfernt werden.

## Rollback

- **Migration rückgängig:** solange der alte Schlüssel (Env) gesetzt ist, sind
  alte Ciphertexte lesbar — es gibt nichts zu verlieren. Ein erneuter
  `secure-migrate`-Lauf mit geänderter Env-Lage schlüsselt einfach auf die dann
  höchste Version um.
- **Strict-Modus zurücknehmen:** `WP_SECRETS_STRICT` entfernen → Klartext wird
  wieder toleriert (nur als Notbremse gedacht).
- **Schlüssel versehentlich entfernt:** Env wieder setzen; Ciphertexte sind an
  ihre Version gebunden und werden sofort wieder lesbar. Ohne jeden passenden
  Schlüssel sind die Application Passwords NICHT wiederherstellbar — dann in
  WordPress neue Application Passwords erzeugen und die Verbindung im Admin
  neu speichern (`fehlerhaft`-Zähler zeigt betroffene Verbindungen).

## Mandanten-Grenzen (Kontext dieser Runde)

- agent-service: `EZY_ORGANIZATION_ID` in `~/agent-service/.env` bindet den
  Service an genau eine Organisation; `/agents` + `/approvals` verlangen den
  Org-Kontext (sonst 403) und stempeln `organizationId` auf jede Antwort.
- App-Proxys filtern strikt (`organizationId === eigene Org`) — unmarkierte
  Einträge werden nie ausgeliefert.
- Mehrfach-Mitgliedschaften: aktive Organisation via Header `X-Ezy-Active-Org`,
  serverseitig gegen `app_users` validiert; ohne Angabe bei mehreren
  Mitgliedschaften → 409 mit klarer Meldung.
