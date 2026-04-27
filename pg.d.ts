declare module "pg" {
  export type QueryResult<Row = unknown> = {
    rows: Row[];
  };

  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<Row = unknown>(
      queryText: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
  }
}
