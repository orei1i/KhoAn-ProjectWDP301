import { env } from './shared/config/env';
import { connectMongo, disconnectMongo } from './shared/db/connection';
import { createApp } from './app';
import { startJobs } from './jobs';

async function main() {
  await connectMongo();
  const stopJobs = startJobs();
  const server = createApp().listen(env.PORT, () => {
    // Terminal của VS Code/Windows Terminal biến các URL này thành link bấm được (Ctrl/Cmd + click).
    const at = `http://localhost:${env.PORT}`;
    console.log('');
    console.log(`  🚀  API        ${at}/api                (env=${env.NODE_ENV})`);
    console.log(`  📘  Swagger    ${at}/api/docs           ← bấm vào đây để thử API`);
    console.log(`  📄  OpenAPI    ${at}/api/openapi.json   (dán vào Postman)`);
    console.log(`  📑  Tóm tắt    ${at}/api                (tiếng Việt, có ô lấy token)`);
    console.log(`  ❤   Health     ${at}/health`);
    console.log('');
    console.log('      Mở Swagger bằng lệnh:  npm run docs');
    console.log('');
    if (env.AUTH_DEV_BYPASS) console.warn('⚠  AUTH_DEV_BYPASS is ON — header x-dev-user accepted. Never enable outside local dev.');
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    stopJobs();
    server.close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => { console.error(e); process.exit(1); });
