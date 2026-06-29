import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// SQLite serializes writes; under concurrent inserts (e.g. the media batch upload
// queue, which uploads files in parallel and writes one row each) a colliding write
// throws SQLITE_BUSY. busy_timeout makes SQLite wait-and-retry for up to 5s instead of
// throwing. Best-effort on startup; no-op on non-SQLite providers.
prisma
  .$executeRawUnsafe("PRAGMA busy_timeout = 5000")
  .catch(() => { /* non-SQLite or not yet connected; harmless */ });

export default prisma;
