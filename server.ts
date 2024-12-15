import Surreal from "@surrealdb/surrealdb";

//import { Surreal, RecordId, Table } from "surrealdb";

const db = new Surreal();

await db.connect("http://192.168.100.1:8081/rpc");

await db.use({
    namespace: "test",
    database: "test"
});

await db.signin({
    username: "root",
    password: "abc123.",
});


const port = 8080;
const hostname = "192.168.100.1";

const handler = async (request: Request): Promise<Response> => {
  //console.log(request.headers);
  //let headers = { "content-type": "text/plain" };
  let headers = { "content-type": "application/json" };
  let body = "";
  const { pathname, search } = new URL(request.url);
  console.log(pathname, search);

  const result = await db.query("SELECT time.created_at as order_date, product_name,<-person.name as person_name,->product.details FROM order LIMIT 4;");
  console.log(result);
  body = JSON.stringify(result);

  return new Response(body, { status: 200, headers: headers });
};

console.log(`HTTP server running. Access it at: http://localhost:${port}/`);
Deno.serve({ hostname, port }, handler);