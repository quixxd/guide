export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** When set, every /api request must carry this token (header x-access-token or ?key=). */
  accessToken: process.env.ACCESS_TOKEN ?? "",
  narrationModel: process.env.NARRATION_MODEL ?? "claude-sonnet-5-5",
  /** Sent to OSM, Wikipedia and routing services, as their usage policies require. */
  userAgent: "GuideTourPrototype/0.1 (+https://github.com/quixxd/guide)",
};
