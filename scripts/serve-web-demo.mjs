import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";

const port = Number.parseInt(process.argv[2] ?? "4173", 10);
const root = resolve(process.argv[3] ?? process.cwd());

function resolveFilePath(pathname) {
  if (pathname === "/") {
    return resolve(root, "packages/web-demo/index.html");
  }

  const candidates = [];

  if (pathname.startsWith("/sdk/")) {
    const base = resolve(root, "packages" + normalize(pathname));
    candidates.push(base, base + ".js");
  } else if (pathname.startsWith("/dist/")) {
    const base = resolve(root, "packages/web-demo" + normalize(pathname));
    candidates.push(base, base + ".js");
  } else {
    const base = resolve(root, `.${normalize(pathname)}`);
    candidates.push(base, base + ".js");
  }

  return candidates.find(p => existsSync(p) && !statSync(p).isDirectory()) ?? candidates[0];
}

/**
 * 浏览器演示页本地静态服务。
 *
 * 这里直接复用 Bun/Node 的 `http` 能力，避免依赖平台相关的 PowerShell `HttpListener`，
 * 确保仓库在当前工具链下可以稳定启动本地页面进行冒烟验证。
 */
const server = createServer((request, response) => {
  const rawPath = request.url ?? "/";
  const url = new URL(rawPath, `http://127.0.0.1:${port}`);
  const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolvedPath = resolveFilePath(url.pathname);

  if (!resolvedPath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (!existsSync(resolvedPath) || statSync(resolvedPath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Not Found: ${relativePath}`);
    return;
  }

  const contentType = contentTypeForExtension(extname(resolvedPath).toLowerCase());
  response.writeHead(200, { "Content-Type": contentType });
  createReadStream(resolvedPath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SERVING:http://127.0.0.1:${port}/`);
  console.log(`ROOT:${root}`);
});

function contentTypeForExtension(extension) {
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
