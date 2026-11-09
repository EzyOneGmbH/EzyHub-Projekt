"""EzyHub Connector als WordPress-ZIP packen (public/downloads/ezyhub-connector.zip).

Nach jeder Plugin-Änderung ausführen: python scripts/plugin-zip.py
Ohne Tests, Composer- und PHPUnit-Dateien; Pfade mit «/» (WordPress-Upload).
"""
import os, zipfile, pathlib

wurzel = pathlib.Path(__file__).resolve().parent.parent
quelle = wurzel / "wordpress-plugin" / "ezyhub-connector"
ziel = wurzel / "public" / "downloads" / "ezyhub-connector.zip"
AUS = {"tests", "vendor", "composer.json", "composer.lock", "phpunit.xml.dist", ".gitignore", ".phpunit.result.cache"}

ziel.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
    for pfad in sorted(quelle.rglob("*")):
        rel = pfad.relative_to(quelle)
        if rel.parts[0] in AUS or pfad.is_dir():
            continue
        z.write(pfad, "ezyhub-connector/" + "/".join(rel.parts))
print(ziel, os.path.getsize(ziel), "Bytes")
