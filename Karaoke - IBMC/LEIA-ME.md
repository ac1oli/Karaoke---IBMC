# KaraokêLive + Supabase — Guia de Instalação

Seu site agora busca tudo (músicas, playlists, histórico, MP3s) de um banco de
dados na nuvem (Supabase), em vez do navegador. Qualquer pessoa que acessar o
link vê a mesma biblioteca, de qualquer aparelho.

**Como ficou o controle de acesso:** todo mundo pode ver e tocar as músicas
(biblioteca, playlists, favoritas). Só **você**, logado como admin, pode
adicionar, editar ou excluir música/playlist.

Siga os passos abaixo, na ordem. Leva uns 10-15 minutos.

---

## Passo 1 — Rodar o script SQL no Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) e abra o
   seu projeto (`lkspvoayojgdmokwmexs`).
2. No menu lateral, clique em **SQL Editor** → **New query**.
3. Abra o arquivo `supabase-schema.sql` (vem junto com este pacote), copie
   **todo** o conteúdo e cole no editor.
4. Clique em **Run**. Isso cria as tabelas (`songs`, `playlists`,
   `playlist_songs`, `history`), as regras de segurança (RLS) e os dois
   buckets de armazenamento (`mp3s` e `thumbnails`).

Se aparecer algum erro de "already exists", pode ignorar — o script é seguro
para rodar mais de uma vez.

## Passo 2 — Criar seu login de admin

1. No menu lateral do Supabase, vá em **Authentication** → **Users**.
2. Clique em **Add user** → **Create new user**.
3. Preencha um e-mail e uma senha (essa é a senha que você vai usar pra
   entrar como admin no site). Marque **Auto Confirm User**.
4. Clique em **Create user**.

### Recomendado: travar o cadastro público
Ainda em **Authentication** → vá em **Sign In / Providers** (ou
**Settings**, dependendo da versão do painel) e desative a opção de permitir
que novas pessoas se cadastrem sozinhas (**"Allow new users to sign up"**).
Assim, só a conta que você criou no passo acima consegue logar como admin.

## Passo 3 — Pegar sua chave do Supabase (completa)

1. No Supabase, vá em **Project Settings** (ícone de engrenagem) → **API Keys**.
2. Copie a chave **publishable** (ou **anon public**, dependendo da versão do
   painel) — é uma chave longa que começa com `sb_publishable_...` ou `eyJ...`.
3. Abra o arquivo `config.js` (neste pacote) e cole a chave completa no lugar
   de `'COLE_AQUI_SUA_CHAVE_PUBLICAVEL_COMPLETA'`.

   > Essa chave é segura para ficar no código do site — ela não dá acesso de
   > escrita a ninguém, pois quem protege os dados é a regra de segurança
   > (RLS) que você criou no Passo 1. **Nunca** use a chave "secret" /
   > "service_role" aqui — essa sim é secreta e não pode aparecer em código
   > que roda no navegador.

## Passo 4 — Subir os arquivos para sua hospedagem

Envie estes 4 arquivos para o Netlify/Vercel/GitHub Pages (ou onde você já
hospeda o site), substituindo os antigos:

- `index.html`
- `app.js`
- `config.js` (com sua chave já colada)
- `styles.css` (sem alterações, mas inclua mesmo assim)

## Passo 5 — Testar

1. Abra o site publicado. A biblioteca deve aparecer vazia (ainda não tem
   músicas).
2. Clique no rodapé da barra lateral em **"Entrar como admin"**, digite o
   e-mail/senha que você criou no Passo 2.
3. Depois de logado, vão aparecer os botões de **"+ Adicionar música"**,
   **"+ Nova playlist"** e **"Exportar / Importar"** — esses só o admin vê.
4. Adicione uma música de teste com um MP3 pequeno e confira se toca.
5. Abra o site em outro navegador (ou peça pra alguém abrir pelo celular)
   **sem fazer login** — a música deve aparecer e tocar normalmente, mas sem
   os botões de editar/excluir.

---

## Se você já tinha músicas salvas no app antigo (localStorage/IndexedDB)

O app antigo tinha um botão de **Exportar tudo** (em Exportar/Importar). Se
você salvou um backup `.json` daquele app antes da troca, pode importar aqui:
entre como admin → **Exportar / Importar** → **Escolher arquivo** → selecione
o JSON do backup antigo. Os MP3s embutidos no JSON serão enviados
automaticamente para o Supabase Storage.

---

## Sobre os limites do plano gratuito do Supabase

- **Banco de dados:** 500 MB (suficiente pra dezenas de milhares de músicas,
  já que cada linha é só texto/metadado).
- **Armazenamento de arquivos (MP3s/capas):** 1 GB — dá pra uns 200-300 MP3s
  em qualidade média.
- **Transferência (banda) por mês:** 5 GB.

Quando isso apertar, o plano **Pro** (a partir de US$25/mês) libera 100 GB de
armazenamento e 250 GB de banda — não precisa migrar nada, é só fazer o
upgrade do mesmo projeto quando chegar a hora.

---

## O que mudou tecnicamente (resumo)

| Antes                        | Agora                                  |
|-------------------------------|------------------------------------------|
| Músicas/playlists/histórico no `localStorage` | Tabelas no Postgres (Supabase)         |
| MP3s no `IndexedDB` do navegador | Arquivos no Supabase Storage (bucket `mp3s`) |
| Um único usuário, sem login   | Leitura pública + escrita só para admin logado |
| Dados presos a um navegador/aparelho | Dados acessíveis de qualquer lugar |
