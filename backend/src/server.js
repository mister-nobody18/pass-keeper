import dotenv from 'dotenv';
dotenv.config();

const { default: app } = await import('./app.js');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`Pass Keeper backend listening on http://localhost:${PORT}`);
});
