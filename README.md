# LVM News — Backend

API REST do jornal digital da E.E. Lênio Vieira de Moraes. Node.js + Express + PostgreSQL + Redis.

## Rodando localmente com Docker (mais fácil)

```bash
cp .env.example .env
# edite o .env com seus segredos (JWT_SECRET, OPENAI_API_KEY se quiser IA)
docker compose up --build
```

Isso sobe o backend na porta 3000, um Postgres já com o schema criado (`lvm_news_schema.sql`) e um Redis.

## Rodando sem Docker

Pré-requisitos: Node 18+, PostgreSQL 14+ rodando localmente.

```bash
npm install
cp .env.example .env
# ajuste DATABASE_URL no .env para apontar para seu Postgres local

psql -U seu_usuario -d lvm_news -f lvm_news_schema.sql

npm run dev
```

## Estrutura

```
src/
  config/       conexão com Postgres e Redis
  middleware/   autenticação JWT, checagem de permissões, rate limiting
  routes/       auth, noticias, comentarios, usuarios, agenda, ia, admin
  utils/        geração de tokens, log de auditoria
server.js       ponto de entrada
```

## Autenticação

- Alunos logam com `ra` no campo `identificador`.
- Professores/secretaria/diretoria logam com `credencial_institucional` no campo `identificador`.
- `POST /api/auth/login` retorna `accessToken` (JWT curto, 8h) e `refreshToken` (7 dias).
- Toda rota protegida espera `Authorization: Bearer <accessToken>`.

## Permissões por papel

A tabela `permissoes` no banco define o que cada `tipo_usuario` pode fazer.
O middleware `exigirPermissao('acesso_editorial')` consulta essa tabela — não há
regras de papel *hardcoded* no código, então dá pra ajustar em tempo real via
`PATCH /api/admin/permissoes/:tipoUsuario`.

Como a escola é só ensino médio (1º ao 3º ano), professor, secretaria e
diretoria compartilham o mesmo nível de acesso — não há segmentos/coordenações
diferentes que justifiquem separar os papéis. `tipo_usuario` continua existindo
para identificação de quem fez cada ação (aparece nos logs de auditoria).

| Papel | Editorial | Aprovação | Agenda | Moderação | Estatísticas | Gerenciar usuários | Configurações |
|---|---|---|---|---|---|---|---|
| aluno | não | não | não | não | não | não | não |
| professor | sim | sim | sim | sim | sim | sim | sim |
| secretaria | sim | sim | sim | sim | sim | sim | sim |
| diretoria | sim | sim | sim | sim | sim | sim | sim |

## Cadastro e confirmação de e-mail

- `POST /api/auth/registrar-aluno` — nome, email, ra, turma (`1º`–`3º` + letra, ex: `2ºB`), senha
- `POST /api/auth/registrar-equipe` — nome, email, usuario, tipo_usuario, senha
- Nenhuma das duas rotas ativa a conta imediatamente: ambas geram um token e chamam
  `enviarEmailConfirmacao()` (em `src/utils/email.js`)
- `GET /api/auth/confirmar-email/:token` ativa a conta (`email_verificado = true`)
- `POST /api/auth/reenviar-confirmacao` reenvia o link se a conta ainda não foi confirmada
- `POST /api/auth/login` recusa login (`403`) enquanto `email_verificado` for `false`

**Sobre o envio de e-mail real**: `src/utils/email.js` vem com um stub que só
loga o link no console em desenvolvimento — não é possível testar o envio de
verdade sem configurar um provedor. Pra produção, troque o corpo da função
`enviarEmailConfirmacao` por uma chamada ao Resend, SendGrid ou Amazon SES
(exemplo comentado no próprio arquivo). A assinatura da função não muda, então
nenhuma rota precisa ser alterada depois.

## IA integrada

As rotas em `/api/ia` chamam a API da OpenAI (`OPENAI_API_KEY` no `.env`).
Troque a função `chamarIA` em `src/routes/ia.routes.js` se preferir Azure Cognitive
Services — a assinatura da função é a única coisa que os outros endpoints conhecem.

- `POST /api/ia/sugerir-titulos`
- `POST /api/ia/resumir`
- `POST /api/ia/revisar-ortografia`
- `POST /api/ia/detectar-plagio` (heurística local de similaridade, não chama IA externa)
- `POST /api/ia/moderar-comentario`

## Segurança implementada

- Senhas com bcrypt (`BCRYPT_SALT_ROUNDS`, padrão 12)
- JWT assinado com segredo próprio para access e refresh tokens
- `helmet` para headers HTTP seguros
- Rate limiting geral (300 req/15min) e reforçado no login (8 tentativas/15min)
- Todas as queries parametrizadas (`$1, $2...`) — sem concatenação de SQL
- Log de auditoria (`logs_administrativos`) em toda ação sensível: aprovar/recusar
  matéria, moderar comentário, (de)ativar usuário, alterar permissão

## Próximos passos sugeridos

- Upload de imagens/áudio/vídeo (Libras) — usar S3-compatível (ex: Cloudflare R2)
  em vez de salvar binário no banco
- Geração automática de `versao_audio` via text-to-speech (Azure Speech ou similar)
- WebSocket para notificações em tempo real
- Testes automatizados (Jest + supertest)
