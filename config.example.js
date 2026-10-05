// Kopie dieser Datei als `config.js` anlegen und ausfuellen.
// `config.js` ist in .gitignore und wird beim Netlify-Deploy aus den
// Umgebungsvariablen der Site erzeugt (siehe build.sh).
//
// Der Anon-/Publishable-Key ist oeffentlich und darf im Browser stehen –
// der Schutz kommt ausschliesslich ueber Row Level Security.
// Niemals den service_role-Key hier eintragen!

export const CONFIG = {
  SUPABASE_URL: "https://DEIN-PROJEKT.supabase.co",
  SUPABASE_ANON_KEY: "DEIN-ANON-PUBLISHABLE-KEY",

  // Optional: hCaptcha-Sitekey. Leer lassen, wenn in Supabase
  // (Authentication -> Settings -> Bot and Abuse Protection) kein
  // Captcha aktiviert ist.
  // Achtung Datenschutz: Mit Key laedt die Login-Seite Code von
  // js.hcaptcha.com (Intuition Machines, USA). Dann vorher einen Abschnitt
  // zu hCaptcha in datenschutz.html ergaenzen.
  HCAPTCHA_SITE_KEY: ""
};
