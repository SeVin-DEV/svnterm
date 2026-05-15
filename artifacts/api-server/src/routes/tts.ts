import { Router } from 'express';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.post('/', async (req, res) => {
  const { text } = req.body;
  
  // Looks at .env first, then falls back to defaults
  const piperBinary = process.env.PIPER_BINARY || '/usr/local/bin/piper';
  const modelPath = process.env.PIPER_MODEL || '/opt/piper/en_GB-low.onnx';
  const outputPath = path.join(__dirname, '../../public/output.wav');

  if (!text) return res.status(400).json({ error: 'Text is required' });

  // Escaping the text to prevent shell injection
  const command = `echo "${text.replace(/"/g, '\\"')}" | ${piperBinary} --model ${modelPath} --output_file ${outputPath}`;

  exec(command, (error) => {
    if (error) {
      console.error(`Piper error: ${error}`);
      return res.status(500).json({ error: 'TTS Generation Failed' });
    }
    res.json({ url: '/output.wav' });
  });
});

export default router;