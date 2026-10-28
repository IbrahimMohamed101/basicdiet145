const ALLOWED_MEAL_IMAGE_IDS = new Set([
  "11PrvdVeUBEzD2YeRZBnMo4rEJGzcgx_b",
  "11b9wuwyURXCFABlvQFWtO7dhuJheqcMr",
  "15DKTySV0UFCKvVrDO0HS4N4hvX7lFEbl",
  "15TkpTJ9XXeIzZ0mNBZC1MJ8t8awZbBwt",
  "16cU7tDnUdsHgBVusLxZHsnPVT1JVNssw",
  "18NreM3mE8ojn2xLMg3mAFsPHv0vTqTIZ",
  "18agybLqHrPNAxEgKfhzZnQY6Fpg5noV9",
  "1BqFpoYmbRArFaXDVZxnSrPsehrXoRDNp",
  "1GPoa36urXJ-H_pZQc1N3t4qc98yI_1WX",
  "1H2InhiMdECMrs8bsf6L_h9yM-rOfYqw6",
  "1IxuZvbSI85kxn9pwF97kGCeScVpz0fdv",
  "1Jk3Xg_v-3dQRVx41KNlq_cr5F3aGYZHC",
  "1KMT7ukfz2OiHWbrLpN21flnZwKTcjYJD",
  "1L6iBu7T7xAmu0nx67fHMgvpxBNCSa0fL",
  "1POU5X9gYEz1ohchifjwDVbCR_jTnJ7Bg",
  "1QSkqR9fYxMC2mR-0cgLGMPaOZ7qJNWT3",
  "1SNJsJ7co4FrNqRkztymUtN2Sxknd3fNv",
  "1U8htEPZ4p9xG3G8aTFAHBt_odPxmSnIW",
  "1YKPJ9BsoRyqu9BQHBtuJm1aOoVMXJ2QY",
  "1YTWcy9AbrDhSr_SMyYfYJn8AFfHzy12D",
  "1YfqmYzRPFcG1TSGU3lJWp-80kQ4WS33-",
  "1YkyR9OEOMKTP3yg-FAFe_Luya8cJOULs",
  "1Z8g0vsxglmgktkzMSGOoLLMYyQegmC3Q",
  "1ZBMwQc-yIT1QjphDRNRZLTeXCbUFVRCU",
  "1bezXaW35QSvbEV7yEWtShjbltYsN5E1b",
  "1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu",
  "1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_",
  "1n2d5Ptmlto1yUpt-RU2iqBhqP9F1ELjx",
  "1n57qM_IYM4srSeCIR6InAisYXaGDY49Z",
  "1niUYE8DPHKnOuXEA-8DO9DYDJs3xv82U",
  "1qkbs_f6Twt50ujTPlEezn2HFydP6c_tB",
  "1r2WcoxoHFG8iM2RfqzYfKo6tiKqZ7ohF",
  "1sy-3ZQPMpkkUTLqYy872SYM1D2Utdnl0",
  "1tASbr8vUBgPqdeJywruTTGdUrS7l-unS",
  "1wCFHNOyUeKD87rLuGVvWAWGVLnndI8a5",
  "1y1jr9EftvmqVYpckSnuwi7SUwDoBpvzH",
  "1zI0zretDPXUzYLTlJMQBlqPj0SI35Wmm",
  "1J0uWPLXV7sTiQEfZzAf0W0WK_HrYpt5O", // رز أبيض
  "1QKGfdTGcXJKk_dk9gpg4dJlb27ibEbcD", // رز بالكركم
  "1Yee9VzPNT76BYe8BwTWrxjsq1Y6qZoBl", // بطاطا مشوية
  "1JR-lQhqRwbwjB9p7nk2n6LNBBiAW1Dne", // باستا الفريدو
  "1nV7bXQ6gkvuqujifJExqEI54zDRFq5--", // دجاج تكا
  "16ODUfITCjcKtZXzaKekc6M1ekkbHjNSb", // دجاج آسيوي
  "1zmxsFVYROw1_3cTpaXKV2GDxX-lHzofQ", // دجاج باربكيو
  "1gciSqekCnVLdjxl9jv7HAF8mUgAn2sc_", // لحم استرغانوف
  "1EQDqVq3zMgYFPR__zwIla8hUGutkmiL_", // دجاج بالليمون
  "1O54P_hDBopu9POcVVB6XEOYeNdLiYFR5", // باستا صوص أحمر
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
