import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function runPiper(text: string, outFile: string, model: string, binary: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ["--model", model, "--output_file", outFile], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin.end(text, "utf8");
    const errs: string[] = [];
    proc.stderr.on("data", (d: Buffer) => errs.push(d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${errs.join("")}`));
    });
    proc.on("error", reject);
  });
}

function runEspeak(text: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("espeak-ng", ["-w", outFile, "--", text], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`espeak-ng exited ${code}`));
    });
    proc.on("error", reject);
  });
}

router.post("/tts", async (req, res) => {
  const text =
    typeof req.body?.text === "string" ? req.body.text.slice(0, 4096).trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const piperBinary = process.env.PIPER_BINARY ?? "/usr/local/bin/piper";
  const piperModel =
    process.env.PIPER_MODEL ?? "/opt/piper/en_US-lessac-medium.onnx";
  const hasPiper = existsSync(piperBinary) && existsSync(piperModel);
  const hasEspeak = existsSync("/usr/bin/espeak-ng");

  if (!hasPiper && !hasEspeak) {
    res.status(503).json({
      error:
        "No TTS engine installed. Run install.sh (or update.sh) to set up Piper TTS.",
    });
    return;
  }

  const outFile = join(tmpdir(), `tts-${randomUUID()}.wav`);
  try {
    if (hasPiper) {
      await runPiper(text, outFile, piperModel, piperBinary);
      logger.debug("TTS: piper generated audio");
    } else {
      await runEspeak(text, outFile);
      logger.debug("TTS: espeak-ng generated audio");
    }

    const audio = await readFile(outFile);
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(audio);
  } catch (err) {
    logger.error({ err }, "TTS generation failed");
    res.status(500).json({ error: "TTS generation failed" });
  } finally {
    unlink(outFile).catch(() => {});
  }
});

export default router;
