/* =============================================================
   KaraokêLive — Configuração do Supabase
   Edite só este arquivo. Não mexe no resto.
============================================================= */

const SUPABASE_URL = 'https://lkspvoayojgdmokwmexs.supabase.co';

// ⚠️ Cole aqui sua chave PUBLICÁVEL completa (publishable / anon public).
// Encontre em: Supabase Dashboard → Project Settings → API Keys.
// Essa chave é segura para expor no front-end — quem protege os dados
// de verdade é a Row Level Security (RLS), configurada via supabase-schema.sql.
// NUNCA coloque aqui a chave "secret" / "service_role" — essa não pode
// aparecer em código que roda no navegador.
const SUPABASE_ANON_KEY = 'sb_publishable_YEr20kBnB5ywPKtU4btTnA_43XOkj9a';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
