// Per-test-file setup. Ensures every test process talks to the SQLite test db.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
