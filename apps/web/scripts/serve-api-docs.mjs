import { spawn } from "node:child_process";
import { get } from "node:http";

const port = Number(process.env.API_DOCS_PORT || 4177);
const host = "127.0.0.1";
const pagePath = "/customer-api.html";
const pageUrl = `http://${host}:${port}${pagePath}`;

const checkExistingServer = () =>
  new Promise((resolve, reject) => {
    const request = get(
      { hostname: host, port, path: pagePath, timeout: 700 },
      response => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", chunk => {
          body += chunk;
        });
        response.on("end", () => {
          if (
            response.statusCode === 200 &&
            body.includes("Pictobook Customer API")
          ) {
            resolve("already-serving");
          } else {
            reject(
              new Error(
                `Port ${port} is in use, but it is not serving the Pictobook Swagger page.`
              )
            );
          }
        });
      }
    );
    request.on("timeout", () =>
      request.destroy(new Error("Connection timed out"))
    );
    request.on("error", error => {
      if (error.code === "ECONNREFUSED") resolve("available");
      else reject(error);
    });
  });

try {
  const state = await checkExistingServer();
  if (state === "already-serving") {
    console.log(`Swagger UI is already running: ${pageUrl}`);
    process.exit(0);
  }
} catch (error) {
  console.error(error.message);
  console.error("Set API_DOCS_PORT to use another port.");
  process.exit(1);
}

const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(port),
    "--bind",
    host,
    "--directory",
    "../../docs",
  ],
  { stdio: "inherit" }
);

server.on("error", error => {
  console.error(`Could not start the Swagger docs server: ${error.message}`);
  process.exitCode = 1;
});
server.on("exit", code => {
  if (code && code !== 0) process.exitCode = code;
});

console.log(`Swagger UI will be available at ${pageUrl}`);
