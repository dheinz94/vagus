#!/bin/sh
# Baut beide Versionen aus demselben Code:
#  vagus.html  → Claude-Version (Artifact)
#  dist/       → eigenständige Web-App (Browser + iPhone)
set -e
cd "$(dirname "$0")"
BUILD=$(cat head.html logic.js platform.js ui.js | sha256sum | cut -c1-10)
SCRIPT() { printf '%s\n' '<script>'; cat logic.js; printf '\n'; cat platform.js; printf '\n'; cat ui.js; printf '%s\n' '</script>'; }
BODY() { printf '%s\n' '<header class="top" id="top"></header>' '<main class="wrap" id="view"></main>' '<nav class="tabs" id="tabs" aria-label="Hauptnavigation"></nav>' '<div class="tip" id="tip" role="status" hidden></div>'; }
{ cat head.html; BODY; SCRIPT; } > vagus.html
mkdir -p dist/icons
{
  printf '%s\n' '<!doctype html><html lang="de"><head><meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' \
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">' \
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Vagus">' \
    '<meta name="theme-color" content="#0d1215"><meta name="description" content="Erholung, Belastung, Schlaf und Bio-Alter aus deinen COROS-Daten">' \
    '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icons/icon-180.png"><link rel="icon" type="image/png" href="icons/icon-192.png">' \
    '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
  cat head.html
  printf '%s\n' '</head><body>'
  BODY; SCRIPT
  printf '%s\n' "<script>if('serviceWorker' in navigator&&location.protocol==='https:'){navigator.serviceWorker.register('sw.js').catch(function(){})}</script>" '</body></html>'
} > dist/index.html
cp pwa/manifest.webmanifest dist/
sed "s/__BUILD__/$BUILD/" pwa/sw.js > dist/sw.js
[ -d icons ] && cp icons/*.png dist/icons/ 2>/dev/null || true
touch dist/.nojekyll
echo "build $BUILD"
