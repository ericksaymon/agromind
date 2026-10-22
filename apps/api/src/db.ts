import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { settings } from "./config";
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: settings.databaseUrl, max: 8 }) });
