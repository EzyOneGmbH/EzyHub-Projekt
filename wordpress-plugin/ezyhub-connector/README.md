# EzyHub Connector (WordPress-Plugin)

Ein Plugin pro Kunde, zwei Schnittstellen:

| Namespace | Zweck | Auth |
| --- | --- | --- |
| `ezyhub/v1` | Technische SEO-Massnahmen der Agentur (head-Snippets, llms.txt, Seiten-Meta, robots.txt, Alt-Texte, Elementor) | WordPress Application Password (manage_options) |
| `ezyrank/v1` (ab 2.0) | Blog-Autopilot: Entwürfe anlegen, Bilder, SEO-Felder, Veröffentlichen | Verbindungsschlüssel `ezr_…` mit Berechtigungen |

## Blog-Autopilot einrichten (Kunde)

1. Plugin installieren und aktivieren.
2. **Einstellungen › EzyRank** › «Verbindungsschlüssel erzeugen». Der Schlüssel wird einmal angezeigt.
3. In EzyHub Site-URL und Schlüssel eintragen, «Verbindung testen».

Berechtigungen: `read` und `draft` sind immer aktiv; `publish` ist aus und wird nur im Plugin eingeschaltet.

## Endpunkte `ezyrank/v1`

Alle verlangen den Schlüssel (`Authorization: Bearer ezr_…` oder `X-EzyRank-Key`), nur HTTPS.

| Methode | Route | Berechtigung |
| --- | --- | --- |
| GET | `/health`, `/capabilities`, `/taxonomies`, `/authors` | read |
| GET | `/posts/{id}`, `/posts/by-external/{external_id}` | read |
| POST | `/posts` (Upsert über `external_id`, nur draft/pending) | draft |
| PATCH | `/posts/{id}` (nur EzyRank-Beiträge) | draft |
| POST | `/media` (nur Bilder aus dem EzyHub-Speicher) | draft |
| POST | `/test` (Testentwurf anlegen und sofort löschen) | draft |
| POST | `/posts/{id}/publish` | publish |

Fehlercodes: `ezr_auth_missing`, `ezr_auth_invalid`, `ezr_rate_limited`, `ezr_scope_missing`,
`ezr_image_failed`, `ezr_https_required` (Kap. 7.10 der Bauanleitung).

Konstanten (nur in `wp-config.php` überschreibbar): `EZYRANK_API_HOST` (Standard `ezyhub.ch`),
`EZYRANK_STORAGE_HOST` (erlaubter Bild-Speicher).

## Aktualisieren

- Neu installieren: Ordner `ezyhub-connector/` ohne `tests/`, `vendor/`, `composer.json`,
  `phpunit.xml.dist` als ZIP packen und in WordPress hochladen («Plugin ersetzen»).
- Ferngesteuert: `POST /ezyhub/v1/plugin/self-update` mit `contentB64` (Hauptdatei) und ab 2.0
  `files` (`{ "includes/ezyrank/…php": base64, … }`). Von 1.9.x auf 2.0 in zwei Schritten:
  zuerst nur die Hauptdatei (das Modul bleibt aus, solange seine Dateien fehlen), dann erneut
  mit `files`.

## Tests

`.github/workflows/plugin-tests.yml` führt PHPUnit mit der WordPress-Testsuite aus (PHP 7.4 und 8.2).
