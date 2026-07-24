import { pool } from "../db/index.js";


export async function insertLogs(logs:any[]) {

    return {
        accepted: 0,
        rejected: []
    };

}


export async function queryLogs(query:any){

    const result = await pool.query(
        "SELECT * FROM logs ORDER BY timestamp DESC, id DESC"
    );

    return {
        logs: result.rows,
        next_cursor: null
    };

}


export async function queryAggregate(query:any){

    return {
        buckets:[]
    };

}