-- ============================================================
-- LVM NEWS 4.0 — Schema completo (PostgreSQL)
-- Jornal digital da E.E. Lênio Vieira de Moraes
-- ============================================================

CREATE TYPE tipo_usuario_enum AS ENUM ('aluno', 'professor', 'secretaria', 'diretoria');
CREATE TYPE acessibilidade_enum AS ENUM ('nenhuma', 'surdo', 'cego', 'mudo', 'multipla');
CREATE TYPE tema_enum AS ENUM ('claro', 'escuro');
CREATE TYPE categoria_enum AS ENUM ('escola', 'sao_paulo', 'cultura', 'esporte', 'outro');
CREATE TYPE urgente_tipo_enum AS ENUM ('escola', 'sao_paulo');

-- ------------------------------------------------------------
-- 1. usuarios
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id_usuario              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                    VARCHAR(150) NOT NULL,
    email                   VARCHAR(190) NOT NULL UNIQUE,
    senha_hash              VARCHAR(255) NOT NULL,          -- bcrypt hash, nunca texto puro
    tipo_usuario            tipo_usuario_enum NOT NULL,
    ra                      VARCHAR(20) UNIQUE,              -- obrigatório se tipo_usuario = 'aluno'
    turma                   VARCHAR(20),
    credencial_institucional VARCHAR(40) UNIQUE,             -- obrigatório p/ professor/secretaria/diretoria (usuário escolhido no cadastro)
    foto_perfil             TEXT,
    biografia               TEXT,
    xp                      INTEGER NOT NULL DEFAULT 0,
    nivel                   INTEGER NOT NULL DEFAULT 1,
    acessibilidade_tipo     acessibilidade_enum NOT NULL DEFAULT 'nenhuma',
    preferencias_acessibilidade JSONB DEFAULT '{}'::jsonb,   -- ex: {"alto_contraste": true, "narrador_automatico": true}
    tema_preferido          tema_enum NOT NULL DEFAULT 'claro',
    ativo                   BOOLEAN NOT NULL DEFAULT true,
    email_verificado        BOOLEAN NOT NULL DEFAULT false,
    token_verificacao       VARCHAR(64),
    token_verificacao_expira TIMESTAMPTZ,
    ultimo_login            TIMESTAMPTZ,
    data_criacao            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ra_obrigatorio_para_aluno CHECK (
        (tipo_usuario = 'aluno' AND ra IS NOT NULL)
        OR (tipo_usuario <> 'aluno' AND credencial_institucional IS NOT NULL)
    )
);

CREATE INDEX idx_usuarios_token_verificacao ON usuarios (token_verificacao);

CREATE INDEX idx_usuarios_tipo ON usuarios (tipo_usuario);
CREATE INDEX idx_usuarios_email ON usuarios (email);

-- ------------------------------------------------------------
-- 2. permissoes — matriz de acesso por tipo de usuário
-- ------------------------------------------------------------
CREATE TABLE permissoes (
    id_permissao        SERIAL PRIMARY KEY,
    tipo_usuario         tipo_usuario_enum NOT NULL UNIQUE,
    acesso_leitura        BOOLEAN NOT NULL DEFAULT true,
    acesso_comentarios     BOOLEAN NOT NULL DEFAULT true,
    acesso_editorial       BOOLEAN NOT NULL DEFAULT false,   -- publicar/editar notícias
    acesso_aprovacao       BOOLEAN NOT NULL DEFAULT false,   -- aprovar matérias de outros
    acesso_agenda          BOOLEAN NOT NULL DEFAULT false,
    acesso_moderacao       BOOLEAN NOT NULL DEFAULT false,   -- moderar comentários/denúncias
    acesso_estatisticas    BOOLEAN NOT NULL DEFAULT false,
    acesso_gerenciar_usuarios BOOLEAN NOT NULL DEFAULT false,
    acesso_configuracoes   BOOLEAN NOT NULL DEFAULT false,
    acesso_ia_administrativa BOOLEAN NOT NULL DEFAULT false,
    acesso_total           BOOLEAN NOT NULL DEFAULT false
);

-- Seed da matriz de permissões conforme as regras definidas.
-- Escola é só ensino médio (1º ao 3º ano), então a equipe (professor,
-- secretaria e diretoria) compartilha o mesmo nível de acesso — não há
-- diferentes coordenações/segmentos que justifiquem separar os papéis.
INSERT INTO permissoes (tipo_usuario, acesso_leitura, acesso_comentarios, acesso_editorial, acesso_aprovacao, acesso_agenda, acesso_moderacao, acesso_estatisticas, acesso_gerenciar_usuarios, acesso_configuracoes, acesso_ia_administrativa, acesso_total)
VALUES
    ('aluno',      true, true,  false, false, false, false, false, false, false, false, false),
    ('professor',  true, true,  true,  true,  true,  true,  true,  true,  true,  true,  true),
    ('secretaria', true, true,  true,  true,  true,  true,  true,  true,  true,  true,  true),
    ('diretoria',  true, true,  true,  true,  true,  true,  true,  true,  true,  true,  true);

-- ------------------------------------------------------------
-- 3. jornalistas — alunos/professores com carteirinha de imprensa
-- ------------------------------------------------------------
CREATE TABLE jornalistas (
    id_jornalista    SERIAL PRIMARY KEY,
    id_usuario       UUID NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    funcao           VARCHAR(80) NOT NULL,      -- ex: repórter, editor, fotógrafo
    carteira_id      VARCHAR(30) NOT NULL UNIQUE,
    data_registro    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jornalistas_usuario ON jornalistas (id_usuario);

-- ------------------------------------------------------------
-- 4. noticias
-- ------------------------------------------------------------
CREATE TABLE noticias (
    id_noticia              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo                  VARCHAR(200) NOT NULL,
    subtitulo               VARCHAR(300),
    categoria               categoria_enum NOT NULL,
    texto                   TEXT NOT NULL,
    autor_id                UUID NOT NULL REFERENCES usuarios(id_usuario),
    aprovado_por            UUID REFERENCES usuarios(id_usuario),
    data_publicacao         TIMESTAMPTZ,
    data_criacao            TIMESTAMPTZ NOT NULL DEFAULT now(),
    imagens                 TEXT[],
    tags                    TEXT[],
    aprovado                BOOLEAN NOT NULL DEFAULT false,
    versao_audio            TEXT,               -- URL do áudio gerado automaticamente
    versao_libras           TEXT,               -- URL do vídeo em Libras
    versao_leitura_simples  TEXT,               -- texto simplificado (acessibilidade cognitiva)
    resumo_ia               TEXT,               -- resumo automático gerado por IA
    score_plagio             NUMERIC(5,2),       -- % de similaridade detectada
    denuncias_count          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_noticias_categoria ON noticias (categoria);
CREATE INDEX idx_noticias_aprovado ON noticias (aprovado);
CREATE INDEX idx_noticias_autor ON noticias (autor_id);

-- ------------------------------------------------------------
-- 5. curiosidades
-- ------------------------------------------------------------
CREATE TABLE curiosidades (
    id_curiosidade   SERIAL PRIMARY KEY,
    texto             TEXT NOT NULL,
    data_exibicao     DATE NOT NULL UNIQUE
);

-- ------------------------------------------------------------
-- 6. novidades_urgentes
-- ------------------------------------------------------------
CREATE TABLE novidades_urgentes (
    id_urgente   SERIAL PRIMARY KEY,
    texto        VARCHAR(300) NOT NULL,
    tipo         urgente_tipo_enum NOT NULL,
    autor_id     UUID REFERENCES usuarios(id_usuario),
    data_hora    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ativo        BOOLEAN NOT NULL DEFAULT true
);

-- ------------------------------------------------------------
-- 7. comentarios
-- ------------------------------------------------------------
CREATE TABLE comentarios (
    id_comentario   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario      UUID NOT NULL REFERENCES usuarios(id_usuario),
    id_noticia      UUID NOT NULL REFERENCES noticias(id_noticia) ON DELETE CASCADE,
    texto           TEXT,                    -- pode ser nulo se for só emoji/reação (acessibilidade "mudo")
    reacao_emoji    VARCHAR(10),
    data_hora       TIMESTAMPTZ NOT NULL DEFAULT now(),
    moderado        BOOLEAN NOT NULL DEFAULT false,
    denunciado      BOOLEAN NOT NULL DEFAULT false,
    moderado_por    UUID REFERENCES usuarios(id_usuario)
);

CREATE INDEX idx_comentarios_noticia ON comentarios (id_noticia);

-- ------------------------------------------------------------
-- 8. conquistas / conquistas_usuarios
-- ------------------------------------------------------------
CREATE TABLE conquistas (
    id_conquista   SERIAL PRIMARY KEY,
    nome           VARCHAR(100) NOT NULL,
    descricao      TEXT,
    icone          VARCHAR(50)
);

CREATE TABLE conquistas_usuarios (
    id_usuario      UUID NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    id_conquista    INTEGER NOT NULL REFERENCES conquistas(id_conquista) ON DELETE CASCADE,
    data_recebida   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_usuario, id_conquista)
);

-- ------------------------------------------------------------
-- 9. estatisticas
-- ------------------------------------------------------------
CREATE TABLE estatisticas (
    id_usuario          UUID PRIMARY KEY REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    noticias_lidas       INTEGER NOT NULL DEFAULT 0,
    comentarios_feitos   INTEGER NOT NULL DEFAULT 0,
    tempo_total_no_site  INTERVAL NOT NULL DEFAULT '0 minutes'
);

-- ------------------------------------------------------------
-- 10. agenda_escolar (acesso: secretaria e diretoria)
-- ------------------------------------------------------------
CREATE TABLE agenda_escolar (
    id_evento     SERIAL PRIMARY KEY,
    titulo        VARCHAR(150) NOT NULL,
    descricao     TEXT,
    data_evento   TIMESTAMPTZ NOT NULL,
    local         VARCHAR(150),
    criado_por    UUID NOT NULL REFERENCES usuarios(id_usuario)
);

-- ------------------------------------------------------------
-- 11. logs_administrativos — auditoria de ações sensíveis
-- ------------------------------------------------------------
CREATE TABLE logs_administrativos (
    id_log        BIGSERIAL PRIMARY KEY,
    id_usuario    UUID REFERENCES usuarios(id_usuario),
    acao          VARCHAR(100) NOT NULL,   -- ex: 'aprovar_noticia', 'excluir_usuario', 'alterar_permissao'
    detalhes      JSONB,
    ip_origem     INET,
    data_hora     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_usuario ON logs_administrativos (id_usuario);
CREATE INDEX idx_logs_acao ON logs_administrativos (acao);

-- ============================================================
-- Seed inicial de conquistas
-- ============================================================
INSERT INTO conquistas (nome, descricao, icone) VALUES
    ('Primeira Leitura', 'Leu sua primeira notícia no LVM News', 'book-open'),
    ('Voz Ativa', 'Fez 10 comentários respeitosos', 'message-circle'),
    ('Repórter Mirim', 'Teve a primeira matéria aprovada', 'award'),
    ('Inclusão em Foco', 'Usou 3 recursos de acessibilidade diferentes', 'accessibility');

-- ============================================================
-- View auxiliar: permissões efetivas por usuário (join pronto p/ backend)
-- ============================================================
CREATE VIEW vw_usuarios_permissoes AS
SELECT u.id_usuario, u.nome, u.email, u.tipo_usuario, p.*
FROM usuarios u
JOIN permissoes p ON p.tipo_usuario = u.tipo_usuario;
