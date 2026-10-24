// Vercel serverless entry: the Express app as a function. All API path
// prefixes are rewritten here by vercel.json; the SPA is served statically.
import { createApp } from "../src/app.js";

export default createApp();
