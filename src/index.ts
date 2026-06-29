import app from "./app";

const PORT = process.env.PORT ?? 4702;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
