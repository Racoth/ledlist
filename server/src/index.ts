import express from 'express';
import cors from 'cors';
import './db.js';
import { api } from './routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api', api);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`API запущен: http://localhost:${PORT}/api`));
