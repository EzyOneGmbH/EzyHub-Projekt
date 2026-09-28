import { createFileRoute } from "@tanstack/react-router";

// Read-API v1: Swagger-UI-Dokumentation (oeffentlich, laedt /api/v1/openapi.json).
const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5";

export const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>EzyHub Read API</title>
  <link rel="stylesheet" href="${SWAGGER}/swagger-ui.css" />
  <style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.addEventListener("load", function () {
      window.ui = SwaggerUIBundle({
        url: "/api/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: false,
      });
    });
  </script>
</body>
</html>
`;

export const Route = createFileRoute("/api/v1/docs")({
  server: {
    handlers: {
      GET: async () =>
        new Response(DOCS_HTML, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        }),
      ANY: async () =>
        Response.json(
          { error: { code: "method_not_allowed", message: "Only GET is supported." } },
          { status: 405, headers: { Allow: "GET" } },
        ),
    },
  },
});
