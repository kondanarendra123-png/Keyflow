import { GoogleGenAI } from "@google/genai";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to simulate cipher / payload verification
  app.post("/api/transform-cipher", (req, res) => {
    const { rawData } = req.body;
    if (!rawData || typeof rawData !== "string") {
      res.status(400).json({ error: "No raw payload provided" });
      return;
    }

    const prefix = "CodeWE:";
    if (!rawData.startsWith(prefix)) {
      res.status(400).json({ error: `Payload must start with prefix '${prefix}'` });
      return;
    }

    const stripped = rawData.substring(prefix.length);
    const transformed = stripped.replace(/000/g, "786");

    res.json({
      success: true,
      rawData,
      stripped,
      transformed,
      scanCodes: Array.from(transformed).map(char => {
        const mapping: Record<string, number> = {
          "1": 0x1E, "2": 0x1F, "3": 0x20, "4": 0x21, "5": 0x22,
          "6": 0x23, "7": 0x24, "8": 0x25, "9": 0x26, "0": 0x27
        };
        return {
          char,
          scanCode: mapping[char] ? `0x${mapping[char].toString(16).toUpperCase()}` : "UNKNOWN"
        };
      })
    });
  });

  // Serve static assets/build files or middleware in dev mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
