## Ziel
Die veröffentlichte Version soll ohne den Hinweis auf fehlende Backend-Konfiguration laden, und der Client soll zusätzlich ein öffentliches Fallback nutzen, falls die Build-Variablen erneut fehlen.

## Plan
1. **Cloud-/Publish-Status verifizieren**
   - Bestätigen, dass das Projekt nativ mit Lovable Cloud verbunden ist und die veröffentlichte Site öffentlich erreichbar ist.
   - Prüfen, ob Schritt 1 aus deiner Anforderung bereits erfüllt ist oder ob nur der Publish/Build inkonsistent war.

2. **Fallback-Logik gegen die gewünschte Reihenfolge prüfen und ggf. angleichen**
   - `src/integrations/supabase/client.ts` auf exakt diese Priorität prüfen:
     `import.meta.env.VITE_* → process.env.SUPABASE_* → öffentliche Fallback-Konstanten`
   - Nur falls nötig minimal anpassen, damit URL und Publishable Key sauber auf die von dir genannten öffentlichen Werte zurückfallen.

3. **Neu veröffentlichen**
   - Die App erneut live stellen, damit der aktuelle Stand in die Published-Version übernommen wird.

4. **Live-Version validieren**
   - `ezyhub.ch` nach dem Publish erneut prüfen.
   - Bestätigen, dass der Config-Fehler nicht mehr erscheint und die App lädt.

## Technische Hinweise
- Aus dem bereits gelesenen Code ist die Fallback-Logik in `src/integrations/supabase/client.ts` schon vorhanden; ich würde sie daher nur anfassen, wenn die Reihenfolge oder die konkreten Werte nicht exakt passen.
- Die native Cloud-Anbindung scheint bereits vorhanden zu sein; der eigentliche Fehler wirkt wie ein Problem des zuletzt veröffentlichten Frontend-Builds.
- Falls die Umgebung nach einem neuen Publish weiterhin denselben Fehler zeigt, ist das ein Publishing-/Build-Problem der Plattform und nicht mehr ein Problem des Anwendungscodes.