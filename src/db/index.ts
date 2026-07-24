import { Pool } from "pg";

export const pool = new Pool(
    {
        user: "loguser",
        password: "logpass",
        host: "localhost",
        port: 5433,
        database: "logdb"
    }
);