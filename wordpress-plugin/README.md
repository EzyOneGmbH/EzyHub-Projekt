# EzyHub Connector (WordPress-Plugin)

Ermöglicht EzyHub, technische SEO-Maßnahmen **autonom** auf einer Kunden-WordPress-Seite zu deployen — Dinge, die die Standard-REST-API nicht kann:

- Globale `<head>`-Injektion (Organization/NGO-JSON-LD, OpenGraph, Meta, BreadcrumbList …)
- `llms.txt` unter `/llms.txt` ausliefern
- Seiten-Meta (SEO-Titel/Description) themeunabhängig setzen

## Sicherheit
- Authentifiziert über **WordPress Application Passwords** (dieselben, die EzyHub schon nutzt) — nur Nutzer mit `manage_options`.
- Alle Änderungen sind **reversibel** (in Optionen gespeichert, nicht im Theme).
- Kein zusätzliches Secret nötig.

## Installation (einmalig pro Kunde)
1. Diesen Ordner als ZIP packen (oder `ezyhub-connector.php` nach `wp-content/plugins/ezyhub-connector/` hochladen).
2. In WordPress → Plugins → aktivieren.
3. Fertig. EzyHub erkennt das Plugin automatisch (`GET /wp-json/ezyhub/v1/status`).

Danach kann der GEO/SEO-Autopilot die vorbereiteten Patches selbst deployen — mit Review-Gate in EzyHub.

## Endpoints (intern, von EzyHub genutzt)
- `GET  /wp-json/ezyhub/v1/status`
- `POST /wp-json/ezyhub/v1/head`       `{ key, html }`
- `POST /wp-json/ezyhub/v1/llms-txt`   `{ content }`
- `POST /wp-json/ezyhub/v1/page-meta`  `{ postId, seoTitle?, seoDescription? }`
