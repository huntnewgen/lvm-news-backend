require("dotenv").config();
const app = require("./src/app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`LVM News backend rodando na porta ${PORT} (${process.env.NODE_ENV || "development"})`);
});
