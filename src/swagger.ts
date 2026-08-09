import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import express from "express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Log Service API",
      version: "1.0.0",
      description: "API documentation for the log ingestion, query, alerting and notification service."
    },
    servers: [
      {
        url: "http://localhost:8080",
        description: "Local development server"
      }
    ],
    tags: [
      { name: "Health", description: "Service liveness checks" },
      { name: "Logs", description: "Log ingestion, querying, aggregation and retention" },
      { name: "Auth", description: "Session-based authentication and user management" },
      { name: "Alerts", description: "Alert rule management" },
      { name: "Notifications", description: "Alert notifications" },
      { name: "Support", description: "AI support assistant" }
    ],
    components: {
      responses: {
        InternalError: {
          description: "Internal server error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" }
            }
          }
        },
        Unauthorized: {
          description: "Authentication required",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" }
            }
          }
        }
      },
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "connect.sid",
          description: "Express session cookie established via POST /auth/login"
        }
      },
      schemas: {
        LogEntry: {
          type: "object",
          required: ["timestamp", "level", "service", "message"],
          properties: {
            timestamp: {
              type: "string",
              format: "date-time",
              description: "Log event timestamp. Rejected if more than 5 minutes in the future."
            },
            level: {
              type: "string",
              enum: ["debug", "info", "warn", "error"]
            },
            service: { type: "string", description: "Name of the emitting service" },
            message: { type: "string", description: "Log message" },
            attributes: {
              type: "object",
              description: "Flat key/value attributes (string, number or boolean values)",
              additionalProperties: { type: "string" }
            }
          }
        },
        LogBatch: {
          type: "object",
          required: ["logs"],
          properties: {
            logs: {
              type: "array",
              items: { $ref: "#/components/schemas/LogEntry" }
            }
          }
        },
        InsertResult: {
          type: "object",
          properties: {
            accepted: {
              type: "integer",
              description: "Number of valid log entries stored"
            },
            rejected: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "Position of the rejected entry in the batch" },
                  reason: { type: "string" }
                }
              }
            }
          }
        },
        Log: {
          type: "object",
          properties: {
            id: { type: "integer" },
            timestamp: { type: "string", format: "date-time" },
            level: { type: "string" },
            service: { type: "string" },
            message: { type: "string" },
            attributes: {
              type: "object",
              nullable: true,
              additionalProperties: { type: "string" }
            }
          }
        },
        LogQueryResult: {
          type: "object",
          properties: {
            logs: {
              type: "array",
              items: { $ref: "#/components/schemas/Log" }
            },
            total: {
              type: "integer",
              nullable: true,
              description: "Always null for cursor pagination."
            },
            next_cursor: {
              type: "string",
              nullable: true,
              description: "Opaque base64 cursor for the next page. Omitted/empty when there are no more pages."
            }
          }
        },
        Bucket: {
          type: "object",
          properties: {
            start: { type: "string", format: "date-time", description: "Bucket start time" },
            group: {
              type: "string",
              nullable: true,
              description: "Grouping value (service or level) when group_by is provided"
            },
            count: { type: "integer", description: "Number of logs in the bucket" }
          }
        },
        AggregateResult: {
          type: "object",
          properties: {
            buckets: {
              type: "array",
              items: { $ref: "#/components/schemas/Bucket" }
            }
          }
        },
        AlertRule: {
          type: "object",
          required: ["threshold", "window_minutes", "webhook_url"],
          properties: {
            service: {
              type: "string",
              nullable: true,
              description: "Restrict the rule to a single service; empty means all services"
            },
            threshold: {
              type: "integer",
              description: "Error count that triggers the alert"
            },
            window_minutes: {
              type: "integer",
              description: "Lookback window in minutes"
            },
            webhook_url: {
              type: "string",
              format: "uri",
              description: "Webhook POSTed to when the alert fires"
            }
          }
        },
        Notification: {
          type: "object",
          properties: {
            id: { type: "integer" },
            type: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            service: { type: "string", nullable: true },
            level: { type: "string", nullable: true },
            is_read: { type: "boolean" },
            created_at: { type: "string", format: "date-time" }
          }
        },
        User: {
          type: "object",
          properties: {
            id: { type: "integer" },
            username: { type: "string" },
            created_at: { type: "string", format: "date-time" }
          }
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        Success: {
          type: "object",
          properties: {
            success: { type: "boolean" }
          }
        }
      }
    }
  },
  apis: ["./src/openapi.yaml"]
};

export const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: express.Application): void {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api-docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}
