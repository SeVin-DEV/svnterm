# Piper TTS Installation (one-time, run on your server as root)

mkdir -p /opt/piper

# 1. Download piper binary
curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
  | tar -xzf - -C /opt/piper --strip-components=1
ln -sf /opt/piper/piper /usr/local/bin/piper

# 2. Download en_US-lessac-medium voice model (~63 MB)
VOICE=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium
curl -fsSL $VOICE/en_US-lessac-medium.onnx      -o /opt/piper/en_US-lessac-medium.onnx
curl -fsSL $VOICE/en_US-lessac-medium.onnx.json -o /opt/piper/en_US-lessac-medium.onnx.json

# 3. Add piper env vars to .env
grep -q PIPER_BINARY /opt/terminal-ai/.env || cat >> /opt/terminal-ai/.env << 'ENVEOF'
PIPER_BINARY=/usr/local/bin/piper
PIPER_MODEL=/opt/piper/en_US-lessac-medium.onnx
ENVEOF

# 4. Restart PM2 to pick up new env vars
pm2 delete terminal-ai-api 2>/dev/null || true
cd /opt/terminal-ai && pm2 start ecosystem.config.cjs && pm2 save

# 5. Test
echo "Voice is working." | piper --model /opt/piper/en_US-lessac-medium.onnx --output_file /tmp/test.wav
curl -s -X POST http://localhost:80/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello."}' --output /tmp/tts.wav && ls -lh /tmp/tts.wav
