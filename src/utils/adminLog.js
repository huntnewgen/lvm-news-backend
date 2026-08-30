const { query } = require("../config/database");

/**
 * Registra uma ação administrativa sensível para auditoria.
 * Chamar sempre que: aprovar/recusar matéria, alterar permissão,
 * excluir usuário, moderar comentário, alterar configuração do sistema.
 */
async function registrarLog({ idUsuario, acao, detalhes = {}, ip = null }) {
  await query(
    `INSERT INTO logs_administrativos (id_usuario, acao, detalhes, ip_origem)
     VALUES ($1, $2, $3, $4)`,
    [idUsuario, acao, JSON.stringify(detalhes), ip]
  );
}

module.exports = { registrarLog };
