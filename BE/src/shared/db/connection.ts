import mongoose from 'mongoose';
import { env } from '../config/env';

export async function connectMongo() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: !env.isProd, // prod: run `npm run sync-indexes` during deploy
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
    w: 'majority',
  });
  console.log(`✅ MongoDB connected: ${mongoose.connection.name}`);
}

export const disconnectMongo = () => mongoose.disconnect();
