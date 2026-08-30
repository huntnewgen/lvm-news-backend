const jwt = require("jsonwebtoken");

function gerarAccessToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id_usuario,
      tipo_usuario: usuario.tipo_usuario,
      nome: usuario.nome,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

function gerarRefreshToken(usuario) {
  return jwt.sign(
    { sub: usuario.id_usuario, tipo: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

function verificarRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = { gerarAccessToken, gerarRefreshToken, verificarRefreshToken };
