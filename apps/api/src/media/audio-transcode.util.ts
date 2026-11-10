import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Transcodificação para nota de voz (PTT).
 *
 * Nota de voz no WhatsApp é OGG/Opus. O `MediaRecorder` do navegador não
 * entrega isso: o Chrome só grava `audio/webm;codecs=opus` (OGG não é opção
 * lá). O stream Opus interno até é o mesmo, mas o CONTÊINER difere, e apenas
 * rotular o mimetype como ogg — que é o que o adapter do Baileys faz quando
 * `asPtt` — produz uma nota de voz que não toca. Por isso a conversão real
 * aqui, com o ffmpeg que já vem na imagem da API.
 *
 * Parâmetros seguem o que o WhatsApp usa em nota de voz: mono, 48 kHz, 32 kbps.
 */

/** Já está no contêiner certo? Então não re-encoda (perda desnecessária). */
export function isOpusOgg(mimetype?: string): boolean {
  return !!mimetype && /^audio\/ogg\b/i.test(mimetype);
}

export const PTT_MIMETYPE = 'audio/ogg; codecs=opus';

export async function transcodeToOpusOgg(input: Buffer): Promise<Buffer> {
  // Arquivo temporário em vez de pipe: o WebM do MediaRecorder sai sem
  // duração/cues no cabeçalho, e nessa forma o ffmpeg falha ao ler de um
  // stdin não-seekable.
  const dir = await mkdtemp(join(tmpdir(), 'wamux-ptt-'));
  const src = join(dir, 'input');
  const dst = join(dir, 'output.ogg');
  try {
    await writeFile(src, input);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-vn',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-f',
      'ogg',
      dst,
    ]);
    const out = await readFile(dst);
    if (!out.byteLength) throw new Error('ffmpeg devolveu um arquivo vazio');
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', (e) => reject(new Error(`ffmpeg indisponível no PATH (${e.message})`)));
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.trim() || '(sem stderr)'}`)),
    );
  });
}
