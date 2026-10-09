const ALLOWED_MEAL_IMAGE_IDS = new Set([
  "1tASbr8vUBgPqdeJywruTTGdUrS7l-unS",
  "1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
  "1bezXaW35QSvbEV7yEWtShjbltYsN5E1b",
  "1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6",
  "1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu",
  "1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_",
]);

const DRIVE_SOURCES = (id: string) => [
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
  `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
  `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`,
];

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!id || !ALLOWED_MEAL_IMAGE_IDS.has(id)) {
    return new Response("Not found", { status: 404 });
  }

  for (const source of DRIVE_SOURCES(id)) {
    try {
      const response = await fetch(source, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 BasicDiet-Landing/1.0",
        },
        next: { revalidate: 60 * 60 * 24 * 7 },
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok || !contentType.startsWith("image/")) {
        continue;
      }

      const body = await response.arrayBuffer();

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        },
      });
    } catch {
      // Try the next Drive source.
    }
  }

  return new Response("Image unavailable", { status: 502 });
}
