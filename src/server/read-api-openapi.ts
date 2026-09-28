// OpenAPI-3.1-Spezifikation der Read-API v1 (28.09.2026).
//
// So gebaut, dass sie direkt als ChatGPT-«Custom GPT Action» importierbar ist:
// je Endpunkt eine eindeutige operationId, knappe englische descriptions
// (ChatGPT kuerzt lange Texte), servers = https://ezyhub.ch, bearerAuth.
// Isomorph und ohne Serverabhaengigkeiten — die Route /api/v1/openapi.json
// liefert das Objekt unveraendert aus; Tests pruefen die Grundstruktur.
import { DEFAULT_TAGE, LIMIT_DEFAULT, LIMIT_MAX, MAX_TAGE } from "./read-api.server";

type Obj = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const pref = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const nullable = (type: string, extra: Obj = {}) => ({ type: [type, "null"], ...extra });

const fehlerAntworten = (mitNotFound: boolean): Obj => ({
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  ...(mitNotFound ? { "404": { $ref: "#/components/responses/NotFound" } } : {}),
  "429": { $ref: "#/components/responses/TooManyRequests" },
  "500": { $ref: "#/components/responses/InternalError" },
});

function listenAntwort(itemSchema: string, beispiel: Obj, meta: Obj = {}): Obj {
  return {
    "200": {
      description: "OK",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["data", "pagination", "meta"],
            properties: {
              data: { type: "array", items: ref(itemSchema) },
              pagination: ref("Pagination"),
              meta: ref("Meta"),
            },
          },
          example: {
            data: [beispiel],
            pagination: { limit: 100, offset: 0, total: 1, next_offset: null },
            meta: {
              from: "2026-09-01",
              to: "2026-09-28",
              generated_at: "2026-09-28T08:00:00.000Z",
              source: "rank_daily",
              coverage: "full",
              ...meta,
            },
          },
        },
      },
    },
  };
}

const DESCRIPTION = [
  "Read-only SEO data API of EzyHub (EZY ONE). Returns data only, no interpretation.",
  "",
  "Scope: every token belongs to exactly one organization; only projects (clients) of that organization are visible. Unknown or foreign project IDs return 404.",
  "",
  "Data coverage:",
  "- Rankings come from daily rank tracking (rank_daily). Tracking covers the top 30 only: position null means 'not in the top 30'. top100 and visibility_index are not available.",
  "- pos_src is the measurement method: 'crawl' = daily SERP crawl (DataForSEO), 'gsc' = Google Search Console average position. Changes are only compared within the same pos_src.",
  "- position_change / change = after - before; positive = loss (worse ranking).",
  "- Search Console and Analytics are only available for projects with connected first-party data (meta.coverage = 'not_connected' otherwise). Search Console has no device/country split, Analytics has no users metric (see meta.unavailable_fields).",
  "",
  `Dates are ISO-8601 (YYYY-MM-DD), inclusive. Default range: last ${DEFAULT_TAGE} days, max. ${MAX_TAGE} days. Pagination: limit 1-${LIMIT_MAX} (default ${LIMIT_DEFAULT}), offset >= 0; continue with pagination.next_offset until it is null.`,
].join("\n");

export function readApiOpenApi(serverUrl = "https://ezyhub.ch"): Obj {
  const projektPfad = (suffix: string) => `/api/v1/projects/{project_id}/${suffix}`;
  return {
    openapi: "3.1.0",
    info: {
      title: "EzyHub Read API",
      version: "1.0.0",
      description: DESCRIPTION,
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "projects" }, { name: "seo" }],
    paths: {
      "/api/v1/projects": {
        get: {
          operationId: "listProjects",
          tags: ["projects"],
          summary: "List projects",
          description:
            "Lists all projects (clients) of the organization with data availability flags. Use the id as project_id in other endpoints.",
          parameters: [pref("limit"), pref("offset")],
          responses: {
            ...listenAntwort(
              "Project",
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Hotel Beispiel",
                domain: "hotel-beispiel.ch",
                country: "CH",
                language: "de",
                status: "active",
                has_rank_tracking: true,
                has_search_console: true,
                has_analytics: false,
              },
              { from: null, to: null, source: "clients" },
            ),
            ...fehlerAntworten(false),
          },
        },
      },
      [projektPfad("rankings")]: {
        get: {
          operationId: "getProjectRankings",
          tags: ["projects"],
          summary: "Daily keyword rankings",
          description:
            "Daily keyword positions of one project with previous_position (last earlier measurement, same pos_src) and change (positive = worse). position null = not in top 30.",
          parameters: [
            pref("project_id"),
            pref("from"),
            pref("to"),
            {
              name: "keyword",
              in: "query",
              required: false,
              description: "Case-insensitive substring filter on the keyword.",
              schema: { type: "string", maxLength: 200 },
            },
            pref("device"),
            pref("country"),
            pref("limit"),
            pref("offset"),
          ],
          responses: {
            ...listenAntwort("RankingRow", {
              date: "2026-09-27",
              keyword: "hotel luzern",
              position: 7,
              previous_position: 4,
              change: 3,
              url: "https://hotel-beispiel.ch/",
              search_volume: 1900,
              pos_src: "crawl",
              is_money: true,
              device: "desktop",
              country: "CH",
            }),
            ...fehlerAntworten(true),
          },
        },
      },
      [projektPfad("ranking-changes")]: {
        get: {
          operationId: "getProjectRankingChanges",
          tags: ["projects"],
          summary: "Ranking changes of one project",
          description:
            "Keywords whose position changed between the first and last measurement in the range (same pos_src). Default direction: losses.",
          parameters: [
            pref("project_id"),
            pref("from"),
            pref("to"),
            pref("direction"),
            {
              name: "min_change",
              in: "query",
              required: false,
              description: "Minimum absolute position change (default 1).",
              schema: { type: "number", exclusiveMinimum: 0, maximum: 1000, default: 1 },
            },
            pref("device"),
            pref("country"),
            pref("limit"),
            pref("offset"),
          ],
          responses: {
            ...listenAntwort(
              "RankingChange",
              {
                keyword: "hotel luzern",
                url: "https://hotel-beispiel.ch/",
                position_before: 4,
                position_after: 9,
                position_change: 5,
                search_volume: 1900,
                country: "CH",
                device: "desktop",
                date_before: "2026-09-24",
                date_after: "2026-09-28",
                pos_src: "crawl",
                dropped_out: false,
              },
              { source: "rank_changes" },
            ),
            ...fehlerAntworten(true),
          },
        },
      },
      [projektPfad("search-console")]: {
        get: {
          operationId: "getProjectSearchConsole",
          tags: ["projects"],
          summary: "Google Search Console performance",
          description:
            "Search Console clicks, impressions, CTR and impression-weighted position, aggregated by the requested dimensions. device/country are always null.",
          parameters: [
            pref("project_id"),
            pref("from"),
            pref("to"),
            {
              name: "dimensions",
              in: "query",
              required: false,
              description: "Comma-separated subset of query,page,date (default: query).",
              schema: { type: "string", default: "query", examples: ["query", "page,date"] },
            },
            {
              name: "query",
              in: "query",
              required: false,
              description: "Case-insensitive substring filter on the search query.",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "page",
              in: "query",
              required: false,
              description: "Case-insensitive substring filter on the page URL.",
              schema: { type: "string", maxLength: 500 },
            },
            pref("limit"),
            pref("offset"),
          ],
          responses: {
            ...listenAntwort(
              "SearchConsoleRow",
              {
                query: "hotel luzern",
                page: null,
                date: null,
                clicks: 120,
                impressions: 3400,
                ctr: 0.0353,
                position: 6.4,
                device: null,
                country: null,
              },
              { source: "gsc_daily", unavailable_fields: ["device", "country"] },
            ),
            ...fehlerAntworten(true),
          },
        },
      },
      [projektPfad("analytics")]: {
        get: {
          operationId: "getProjectAnalytics",
          tags: ["projects"],
          summary: "GA4 sessions and conversions",
          description:
            "GA4 sessions, organic sessions (channel 'Organic Search') and conversions (key events), grouped by date or landing page. users is always null.",
          parameters: [
            pref("project_id"),
            pref("from"),
            pref("to"),
            {
              name: "group_by",
              in: "query",
              required: false,
              description: "Grouping dimension (default: date).",
              schema: { type: "string", enum: ["date", "landing_page"], default: "date" },
            },
            pref("limit"),
            pref("offset"),
          ],
          responses: {
            ...listenAntwort(
              "AnalyticsRow",
              {
                date: "2026-09-27",
                landing_page: null,
                sessions: 310,
                organic_sessions: 145,
                users: null,
                conversions: 6,
              },
              { source: "ga4_landing_daily", unavailable_fields: ["users"] },
            ),
            ...fehlerAntworten(true),
          },
        },
      },
      [projektPfad("visibility")]: {
        get: {
          operationId: "getProjectVisibility",
          tags: ["projects"],
          summary: "Daily visibility counts",
          description:
            "Per day and pos_src: number of tracked keywords, keywords in top 3/10/30 and average position. visibility_index and top100 are always null.",
          parameters: [pref("project_id"), pref("from"), pref("to"), pref("limit"), pref("offset")],
          responses: {
            ...listenAntwort(
              "VisibilityRow",
              {
                date: "2026-09-27",
                visibility_index: null,
                top3: 4,
                top10: 12,
                top30: 25,
                top100: null,
                tracked: 40,
                keywords_ranking: 25,
                avg_position: 9.8,
                pos_src: "crawl",
              },
              { source: "visibility_daily", unavailable_fields: ["visibility_index", "top100"] },
            ),
            ...fehlerAntworten(true),
          },
        },
      },
      "/api/v1/seo/ranking-changes": {
        get: {
          operationId: "getRankingChangesAcrossProjects",
          tags: ["seo"],
          summary: "Ranking changes across all projects",
          description:
            "Ranking changes of all projects of the organization in one list, e.g. to find which clients lost rankings since a date. Default direction: losses.",
          parameters: [
            pref("from"),
            pref("to"),
            pref("direction"),
            {
              name: "min_position_loss",
              in: "query",
              required: false,
              description: "Minimum absolute position change (default 1).",
              schema: { type: "number", exclusiveMinimum: 0, maximum: 1000, default: 1 },
            },
            pref("device"),
            pref("country"),
            pref("limit"),
            pref("offset"),
          ],
          responses: {
            ...listenAntwort(
              "ProjectRankingChange",
              {
                project_id: "11111111-1111-4111-8111-111111111111",
                project_name: "Hotel Beispiel",
                domain: "hotel-beispiel.ch",
                keyword: "hotel luzern",
                url: "https://hotel-beispiel.ch/",
                position_before: 4,
                position_after: null,
                position_change: 27,
                search_volume: 1900,
                country: "CH",
                device: "desktop",
                date_before: "2026-09-24",
                date_after: "2026-09-28",
                pos_src: "crawl",
                dropped_out: true,
              },
              { source: "rank_changes" },
            ),
            ...fehlerAntworten(false),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "ezyi_ra_…",
          description: "Read API token (starts with ezyi_ra_), created by an organization admin.",
        },
      },
      parameters: {
        project_id: {
          name: "project_id",
          in: "path",
          required: true,
          description: "Project id from listProjects.",
          schema: { type: "string", format: "uuid" },
        },
        from: {
          name: "from",
          in: "query",
          required: false,
          description: `Start date (YYYY-MM-DD, inclusive). Default: ${DEFAULT_TAGE} days before 'to'.`,
          schema: { type: "string", format: "date" },
        },
        to: {
          name: "to",
          in: "query",
          required: false,
          description: `End date (YYYY-MM-DD, inclusive, not in the future). Default: today. Max. range ${MAX_TAGE} days.`,
          schema: { type: "string", format: "date" },
        },
        limit: {
          name: "limit",
          in: "query",
          required: false,
          description: "Page size.",
          schema: { type: "integer", minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
        },
        offset: {
          name: "offset",
          in: "query",
          required: false,
          description: "Number of rows to skip (use pagination.next_offset).",
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        device: {
          name: "device",
          in: "query",
          required: false,
          description: "Device filter.",
          schema: { type: "string", enum: ["desktop", "mobile", "tablet"] },
        },
        country: {
          name: "country",
          in: "query",
          required: false,
          description: "Country filter (ISO 3166-1 alpha-2, e.g. CH).",
          schema: { type: "string", pattern: "^[A-Za-z]{2}$" },
        },
        direction: {
          name: "direction",
          in: "query",
          required: false,
          description: "losses = got worse, gains = improved, all = both (default: losses).",
          schema: { type: "string", enum: ["losses", "gains", "all"], default: "losses" },
        },
      },
      schemas: {
        Pagination: {
          type: "object",
          required: ["limit", "offset", "total", "next_offset"],
          properties: {
            limit: { type: "integer" },
            offset: { type: "integer" },
            total: nullable("integer", { description: "Total rows; null if unknown." }),
            next_offset: nullable("integer", {
              description: "Offset of the next page; null = last page.",
            }),
          },
        },
        Meta: {
          type: "object",
          required: ["from", "to", "generated_at", "source", "coverage"],
          properties: {
            from: nullable("string", { format: "date" }),
            to: nullable("string", { format: "date" }),
            generated_at: { type: "string", format: "date-time" },
            source: { type: "string", description: "Internal data source." },
            coverage: {
              type: "string",
              enum: ["full", "partial", "none", "not_connected"],
              description:
                "full = data returned, partial = aggregation truncated, none = no data in range, not_connected = source not connected for this project.",
            },
            unavailable_fields: {
              type: "array",
              items: { type: "string" },
              description: "Fields that are always null because the source does not provide them.",
            },
            notes: { type: "array", items: { type: "string" } },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "validation_error",
                    "unauthorized",
                    "forbidden",
                    "not_found",
                    "method_not_allowed",
                    "rate_limited",
                    "internal_error",
                  ],
                },
                message: { type: "string" },
              },
            },
          },
        },
        Project: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            domain: nullable("string"),
            country: nullable("string"),
            language: nullable("string"),
            status: { type: "string", enum: ["active", "paused"] },
            has_rank_tracking: {
              type: "boolean",
              description: "Rank tracking data in the last 14 days.",
            },
            has_search_console: { type: "boolean" },
            has_analytics: { type: "boolean" },
          },
        },
        RankingRow: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
            keyword: { type: "string" },
            position: nullable("number", { description: "null = not in top 30." }),
            previous_position: nullable("number"),
            change: nullable("number", {
              description: "position - previous_position; positive = worse.",
            }),
            url: nullable("string"),
            search_volume: nullable("number"),
            pos_src: nullable("string", { enum: ["crawl", "gsc", null] }),
            is_money: nullable("boolean"),
            device: nullable("string"),
            country: nullable("string"),
          },
        },
        RankingChange: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            url: nullable("string"),
            position_before: nullable("number"),
            position_after: nullable("number", { description: "null = dropped out of top 30." }),
            position_change: nullable("number", { description: "Positive = loss." }),
            search_volume: nullable("number"),
            country: nullable("string"),
            device: nullable("string"),
            date_before: nullable("string", { format: "date" }),
            date_after: nullable("string", { format: "date" }),
            pos_src: nullable("string"),
            dropped_out: { type: "boolean" },
          },
        },
        ProjectRankingChange: {
          allOf: [
            {
              type: "object",
              properties: {
                project_id: { type: "string", format: "uuid" },
                project_name: { type: "string" },
                domain: nullable("string"),
              },
            },
            ref("RankingChange"),
          ],
        },
        SearchConsoleRow: {
          type: "object",
          properties: {
            query: nullable("string"),
            page: nullable("string"),
            date: nullable("string", { format: "date" }),
            clicks: { type: "integer" },
            impressions: { type: "integer" },
            ctr: { type: "number" },
            position: nullable("number", { description: "Impression-weighted average position." }),
            device: { type: "null" },
            country: { type: "null" },
          },
        },
        AnalyticsRow: {
          type: "object",
          properties: {
            date: nullable("string", { format: "date" }),
            landing_page: nullable("string"),
            sessions: { type: "integer" },
            organic_sessions: { type: "integer" },
            users: { type: "null" },
            conversions: { type: "number" },
          },
        },
        VisibilityRow: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
            visibility_index: { type: "null" },
            top3: nullable("integer"),
            top10: nullable("integer"),
            top30: nullable("integer"),
            top100: { type: "null" },
            tracked: nullable("integer"),
            keywords_ranking: nullable("integer"),
            avg_position: nullable("number"),
            pos_src: nullable("string"),
          },
        },
      },
      responses: {
        BadRequest: fehlerResponse(
          "Invalid parameters.",
          "validation_error",
          "from must not be after to",
        ),
        Unauthorized: fehlerResponse(
          "Missing or invalid token.",
          "unauthorized",
          "Missing or invalid bearer token.",
        ),
        Forbidden: fehlerResponse(
          "Token not allowed.",
          "forbidden",
          "Token is not allowed to access this API.",
        ),
        NotFound: fehlerResponse(
          "Project not found in this organization.",
          "not_found",
          "Project not found.",
        ),
        TooManyRequests: fehlerResponse(
          "Rate limit exceeded.",
          "rate_limited",
          "Too many requests. Please retry later.",
        ),
        InternalError: fehlerResponse(
          "Internal error.",
          "internal_error",
          "Internal server error.",
        ),
      },
    },
  };
}

function fehlerResponse(description: string, code: string, message: string): Obj {
  return {
    description,
    content: {
      "application/json": { schema: ref("Error"), example: { error: { code, message } } },
    },
  };
}
