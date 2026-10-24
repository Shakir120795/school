import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import "./style.css";

createApp(App).use(router).mount("#app");

// PWA: register the app-shell service worker (production web only).
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.Capacitor) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
