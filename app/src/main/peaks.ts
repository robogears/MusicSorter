/**
 * Peak decoder backed by ffmpeg (via the `ffmpeg-static` binary).
 *
 * Used as a fallback when the renderer's Chromium decoder can't handle a
 * file (some FLAC variants, exotic MP3s, etc.). ffmpeg eats anything.
 *
 * We spawn one subprocess per file, asking for 32-bit-float mono PCM piped
 * to stdout, then downsample to N peaks. Stays in main so the renderer
 * never has to know which decoder did the work.
 */
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'

const MAX_PER_FILE_MS = 30_000 // hard timeout per decode

/** Resolve the ffmpeg binary path, accounting for asar unpacking in
 *  production builds (electron-builder rewrites the location). */
function resolveFfmpeg(): string | null {
  const raw = ffmpegStatic as unknown as string | null
  if (!raw) return null
  // In a packaged Electron app the binary lives inside app.asar.unpacked.
  // ffmpeg-static reports the in-asar path; correct it so spawn() can exec.
  if (raw.includes('app.asar')) {
    return raw.replace('app.asar', 'app.asar.unpacked')
  }
  return raw
}

const FFMPEG_BIN = resolveFfmpeg()

interface SpawnResult {
  pcm: Buffer
  exitCode: number | null
  stderr: string
}

function runFfmpeg(filepath: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_BIN) {
      reject(new Error('ffmpeg-static binary not found'))
      return
    }
    const args = [
      '-v', 'error',
      '-i', filepath,
      '-ac', '1',          // mono
      '-ar', '22050',      // 22.05 kHz is plenty for envelope detection
      '-f', 'f32le',       // 32-bit float PCM little-endian
      '-'
    ]
    const proc = spawn(FFMPEG_BIN, args, { windowsHide: true })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
    }, MAX_PER_FILE_MS)

    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        reject(new Error('ffmpeg decode timed out'))
        return
      }
      resolve({
        pcm: Buffer.concat(stdoutChunks),
        exitCode: code,
        stderr: Buffer.concat(stderrChunks).toString('utf-8')
      })
    })
  })
}

export async function computePeaksMain(
  filepath: string,
  nBars = 60
): Promise<number[] | null> {
  if (!FFMPEG_BIN) {
    console.error('[main peaks] ffmpeg binary unavailable')
    return null
  }
  try {
    const { pcm, exitCode, stderr } = await runFfmpeg(filepath)
    if (exitCode !== 0 || pcm.byteLength === 0) {
      console.error(
        `[main peaks] ffmpeg exit ${exitCode} for ${filepath}: ${stderr.slice(0, 200)}`
      )
      return null
    }

    // PCM is float32 little-endian — wrap without copying.
    const samples = new Float32Array(
      pcm.buffer,
      pcm.byteOffset,
      Math.floor(pcm.byteLength / 4)
    )
    if (samples.length === 0) return null

    const chunk = Math.max(1, Math.floor(samples.length / nBars))
    const peaks: number[] = new Array(nBars).fill(0)
    let globalMax = 0

    for (let i = 0; i < nBars; i++) {
      const start = i * chunk
      const end = Math.min(start + chunk, samples.length)
      let max = 0
      for (let j = start; j < end; j++) {
        const a = Math.abs(samples[j])
        if (a > max) max = a
      }
      peaks[i] = max
      if (max > globalMax) globalMax = max
    }

    if (globalMax === 0) return peaks
    return peaks.map((p) => p / globalMax)
  } catch (err) {
    console.error('[main peaks] decode failed for', filepath, err)
    return null
  }
}
