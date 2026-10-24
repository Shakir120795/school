import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`[api] smart-school-api listening on :${config.port}`);
});
