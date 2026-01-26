const CACHE_NAME = "orden-cura-v22";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/icon-192.png",
  "/icon-512.png"
];

// 1. Instalación: Guardar archivos en caché
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Activación: Limpiar cachés viejas
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// 3. Peticiones: Servir desde caché, si no hay, ir a internet
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );

});



















