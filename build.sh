#!/bin/bash
# Netlify-Build: erzeugt config.js aus den Umgebungsvariablen der Site.
set -euo pipefail
cat > config.js << CONF
export const CONFIG = {
  SUPABASE_URL: "$SUPABASE_URL",
  SUPABASE_ANON_KEY: "$SUPABASE_ANON_KEY",
  HCAPTCHA_SITE_KEY: "${HCAPTCHA_SITE_KEY:-}"
}
CONF
