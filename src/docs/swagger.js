const swaggerJSDoc = require("swagger-jsdoc");

const definition = {
  openapi: "3.0.0",
  info: {
    title: "BasicDiet API",
    version: "1.0.0",
    description: "Diet meal subscription backend API",
  },
  servers: [
    { url: "/api", description: "Local API base" },
    { url: "/", description: "Root (non-API endpoints)" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
};

const options = {
  definition,
  apis: ["./src/routes/*.js", "./src/app.js"],
};

module.exports = swaggerJSDoc(options);
