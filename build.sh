#!/bin/bash
# Netlify-Build: erzeugt config.js aus den Umgebungsvariablen der Site.
set -euo pipefail

# Nicht deployen, solange Impressum/Datenschutz noch Platzhalter enthalten.
if grep -l '{{[A-Z_]*}}' ./*.html; then
  echo "Fehler: Platzhalter ({{...}}) in den oben genannten Seiten ausfuellen." >&2
  exit 1
fi

# Erinnerung, solange Angaben fehlen (Seite noch nicht oeffentlich beworben).
if grep -l '\[wird ergänzt\]' ./*.html; then
  echo "Hinweis: Angaben '[wird ergänzt]' in den oben genannten Seiten vor einer oeffentlichen Nutzung ausfuellen." >&2
fi

cat > config.js << CONF
export const CONFIG = {
  SUPABASE_URL: "$SUPABASE_URL",
  SUPABASE_ANON_KEY: "$SUPABASE_ANON_KEY",
  HCAPTCHA_SITE_KEY: "${HCAPTCHA_SITE_KEY:-}"
}
CONF
