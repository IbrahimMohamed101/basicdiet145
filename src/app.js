const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const routes = require("./routes");
const paymentRoutes = require("./routes/payments");
const { getAccountDeletionPage } = require("./controllers/accountDeletionController");
const requestLanguageMiddleware = require("./middleware/requestLanguage");
const errorResponse = require("./utils/errorResponse");
const { logger } = require("./utils/logger");
const { validateAndFixResponse }