require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { limiteGeral } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth.routes");
const noticiasRoutes = require("./routes/noticias.routes");
const comentariosRoutes = require("./routes/comentarios.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const agendaRoutes = require("./routes/agenda.routes");
const iaRoutes = require("./routes/ia.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(limiteGeral);

app.get("/api/saude", (req, res) => {
  res.json({ status: "ok", servico: "lvm-news-backend", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/noticias", noticiasRoutes);
app.use("/api/comentarios", comentariosRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/agenda", agendaRoutes);
app.use("/api/ia", iaRoutes);
app.use("/api/admin", adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

// Tratador de erros central — nunca vaza stack trace em produção
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const mensagem =
    process.env.NODE_ENV === "production" && status === 500
      ? "Erro interno do servidor."
      : err.message || "Erro interno do servidor.";
  res.status(status).json({ erro: mensagem });
});

module.exports = app;
