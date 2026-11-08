import { internal } from "./_generated/api";

const prompt =
  "a tiny astronaut cat riding a red rover on Mars at sunset, cinematic";

await internal.cloudinary.generateImage({ prompt, aspectRatio: "16:9" });
